/**
 * Layer 1 bash execution: run the command wrapped by sandbox-runtime, with
 * pre-flight asks (ADR-015, ADR-019) and an ask-tier prompt on a blocked access.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { type BashOperations } from "@earendil-works/pi-coding-agent";
import { askReadCandidates, attributeLoopbackFailure, extractBlockedPath, isBlockedAccessError, isSafeFolderGrant, isWriteBlockError, matchedAskCommands, matchesPolicyPattern, outsideProjectMode, outsideProjectReadCandidates, outsideProjectReadDenied, sandboxFilesystem } from "../core/index";
import { audit } from "../shared/audit";
import { canonicalize } from "../shared/canonicalize";
import { askMain, askMainWithRemember, askRememberFile, MainChoice, type AskCtx } from "../ui/ask-flow";
import { loadConfig, projectTrusted } from "./config";
import { injectBridgesIntoBwrap, startHostPortBridges, type HostPortBridge } from "./host-bridge";

/** First whitespace-separated token of a bash command — used to name the binary in prompt titles. */
function firstWord(command: string): string {
	return command.trim().split(/\s+/)[0] ?? command;
}
import { beginNetworkCommand, endNetworkCommand } from "./network-ask";

export interface SandboxedBashOpts {
	ctx?: { cwd: string; hasUI?: boolean; ui?: { select?: (t: string, o: string[], op?: { timeout?: number }) => Promise<string | undefined>; notify?: (m: string, l?: string) => void } };
	onAlways?: (absPath: string, scope: "cwd" | "global") => Promise<string>;
	onAlwaysRead?: (absPath: string, scope: "cwd" | "global") => Promise<string>;
}

/** One denial shape for Layer 1, mirroring denyMessage() in Layer 2. */
function blockedLine(action: "Read" | "Write", why: string, outcome: "read" | "written" | "run"): string {
	return `[Security Policy Notice] ${action} blocked by policy: ${why}. Nothing was ${outcome}. Inform the user; do not attempt workarounds.`;
}

/** `Link` body row for a symlinked block path; empty when the spellings agree (ADR-035). */
function linkRow(absPath: string, spelled: string | undefined): string[] {
	return spelled && spelled !== absPath ? [`Link     ${spelled}`] : [];
}

const auditL1 = (entry: Record<string, unknown>) => audit({ layer: 1, tool: "bash", ...entry });

/**
 * In-memory filesystem grants from "Yes, for this conversation" (ADR-010, ADR-012).
 * A read grant is the absolute path; a write grant is the parent directory (a
 * whole path would not let a new file be created — ADR-021), falling back to the
 * exact path when the parent is an unsafe folder to grant (root, home, …).
 * Cleared at session_start, never written to sandbox.json.
 */
const sessionReadGrants: string[] = [];
const sessionWriteGrants: string[] = [];
/** askRead (.env) conversation grants, kept apart so they never leak into allowRead (ADR-019). */
const sessionAskReadGrants: string[] = [];

export function clearFilesystemSessionGrants(): void {
	sessionReadGrants.length = 0;
	sessionWriteGrants.length = 0;
	sessionAskReadGrants.length = 0;
}

export function filesystemSessionGrantSummary(): string {
	return [...sessionWriteGrants.map((p) => `write:${p}`), ...sessionReadGrants.map((p) => `read:${p}`), ...sessionAskReadGrants.map((p) => `askRead:${p}`)].join(", ");
}

/**
 * Gate commands that can print secrets (`printenv`, `env`, a read of the proc
 * environ file). Asks once per call; deny means the command does not run.
 */
async function preflightSensitiveCommands(
	command: string,
	cwd: string,
	opts: SandboxedBashOpts | undefined,
	onData: (chunk: Buffer) => void,
): Promise<{ exitCode: number } | undefined> {
	const ask = loadConfig(cwd).commands?.ask ?? [];
	if (!ask.length || !opts?.ctx?.hasUI || !opts.ctx.ui?.select) return undefined;
	const matched = matchedAskCommands(command, ask, cwd, homedir());
	if (!matched.length) return undefined;
	const ui = opts.ctx as AskCtx;
	const bodyLines: string[] = [
		`Command  ${matched.join(", ")}`,
		`Risk     environment variables often hold API keys and tokens`,
		`Note     can only be allowed one run at a time`,
	];
	if (command.includes("\n")) {
		bodyLines.push(`\nScript:\n${command}`);
	}
	const body = bodyLines.join("\n");
	const choice = await askMain(ui, `Let ${matched[0]} print your environment variables?`, body, { once: true, remember: false, icon: "cred" });
	const subject = matched.join(", ");
	if (choice === "once") {
		auditL1({ subject, decision: "once", note: "sensitive-command", cwd });
		return undefined;
	}
	auditL1({ subject, decision: "no", note: "sensitive-command", cwd });
	onData(Buffer.from(`\n[Security Block] sandbox: command execution was denied by user: ${subject}. Command was not executed.\n`));
	return { exitCode: 1 };
}

/**
 * Ask before a bash command plainly reads a path on the `askRead` list
 * (ADR-019). Headless (no UI) fails closed, like every other gate.
 */
async function preflightAskReads(
	command: string,
	cwd: string,
	opts: SandboxedBashOpts | undefined,
	onData: (chunk: Buffer) => void,
): Promise<{ exitCode: number } | undefined> {
	const cfg = loadConfig(cwd).filesystem;
	if (!cfg?.askRead?.length) return undefined;
	const rawPaths = askReadCandidates(command, cwd, homedir(), cfg, undefined, (absPath) => canonicalize(absPath, cwd));
	if (!rawPaths.length) return undefined;
	const paths = Array.from(new Set(rawPaths.map((p) => canonicalize(p, cwd))));
	const ui = opts?.ctx as AskCtx | undefined;
	for (const absPath of paths) {
		if (sessionAskReadGrants.includes(absPath)) continue;
		if (!ui?.hasUI || !ui.ui?.select) {
			auditL1({ subject: absPath, decision: "no", note: "ask-read-headless", cwd });
			onData(Buffer.from(`\n[Security Block] sandbox: read access to ${absPath} was blocked (automated environment). Command was not executed.\n`));
			return { exitCode: 1 };
		}
		const choice = await askMain(ui, "Let this command read your .env file?", [`File     ${absPath}`, `Why      .env files usually hold passwords and API keys`, `Risk     the AI will see any keys in it`, `Note     can't be saved as a permanent rule (it holds secrets)`].join("\n"), { session: true, remember: false, icon: "cred" });
		if (choice === "once" || choice === "session") {
			if (choice === "session") sessionAskReadGrants.push(absPath);
			auditL1({ subject: absPath, decision: choice, note: "ask-read", cwd });
			continue;
		}
		auditL1({ subject: absPath, decision: "no", note: "ask-read", cwd });
		onData(Buffer.from(`\n[Security Block] sandbox: read access to ${absPath} was denied by user. Command was not executed.\n`));
		return { exitCode: 1 };
	}
	return undefined;
}

async function preflightOutsideReads(
	command: string,
	cwd: string,
	opts: SandboxedBashOpts | undefined,
	onData: (chunk: Buffer) => void,
): Promise<{ blocked: { exitCode: number } } | { once: string[] } | undefined> {
	const cfg = loadConfig(cwd).filesystem;
	if (!cfg || outsideProjectMode(cfg) !== "ask" || !opts?.ctx?.hasUI || !opts.ctx.ui?.select || !opts.onAlwaysRead) {
		return undefined;
	}
	const once: string[] = [];
	const rawCandidates = outsideProjectReadCandidates(command, cwd, homedir(), cfg, undefined, (absPath) => canonicalize(absPath, cwd));
	const candidates = Array.from(new Set(rawCandidates.map((p) => canonicalize(p, cwd))));
	for (const absPath of candidates) {
		if (sessionReadGrants.includes(absPath)) continue;
		const ui = opts.ctx as AskCtx;
		const parent = dirname(absPath);
		const folder = isSafeFolderGrant(parent, homedir()) ? parent : null;
		const { choice, grant } = await askMainWithRemember(
			ui,
			"Let this command read a file outside your project?",
			[`File     ${absPath}`, `Command  ${command}`, `Why      files outside your project need your OK`].join("\n"),
			{ session: true },
			() => askRememberFile(ui, "Always allow reading \u2014 what, and where?", [`File     ${absPath}`, `Folder   ${parent}/`, `Note     the rule works for any command, not just ${firstWord(command)}`].join("\n"), absPath, folder, { icon: "save", untrusted: !projectTrusted(cwd) }),
		);
		if (choice === MainChoice.Once) {
			auditL1({ subject: absPath, decision: "once", reason: "outside-project-read", note: "preflight", cwd });
			once.push(absPath);
			continue;
		}
		if (choice === MainChoice.Session) {
			sessionReadGrants.push(absPath);
			auditL1({ subject: absPath, decision: "session", scope: "session", reason: "outside-project-read", note: "preflight", cwd });
			opts.ctx.ui?.notify?.(`sandbox: allowed read of ${absPath} for this conversation (not saved)`, "info");
			continue;
		}
		if (choice !== MainChoice.Remember || !grant) {
			auditL1({ subject: absPath, decision: "no", reason: "outside-project-read", note: "preflight", cwd });
			onData(Buffer.from(`\n${blockedLine("Read", "outside the project", "run")}\n`));
			return { blocked: { exitCode: 1 } };
		}
		const subject = grant.folder ? parent : absPath;
		const scope = grant.scope;
		try {
			const persistedTo = await opts.onAlwaysRead(subject, scope);
			auditL1({ subject, decision: scope === "cwd" ? "always-cwd" : "always-global", scope, cwd, persisted_to: persistedTo, note: "preflight" });
			opts.ctx.ui?.notify?.(`sandbox: allowed read of ${subject} (${scope})`, "warning");
		} catch (e) {
			auditL1({ subject, scope, cwd, error: String(e), note: "preflight" });
			onData(Buffer.from(`\n❌ sandbox: could not save the permission (${e}). ${subject} remains blocked.\n`));
			return { blocked: { exitCode: 1 } };
		}
	}
	return { once };
}

export function createSandboxedBashOps(opts?: SandboxedBashOpts): BashOperations {
	return {
		async exec(command, cwd, { onData, signal, timeout }) {
			if (!existsSync(cwd)) {
				throw new Error(`Working directory does not exist: ${cwd}`);
			}

			const sensitive = await preflightSensitiveCommands(command, cwd, opts, onData);
			if (sensitive) return sensitive;

			const askRead = await preflightAskReads(command, cwd, opts, onData);
			if (askRead) return askRead;

			const pre = await preflightOutsideReads(command, cwd, opts, onData);
			if (pre && "blocked" in pre) return pre.blocked;
			const readOnce = [...(pre?.once ?? [])];
			const buildCustom = (writeOnce: string[]): Partial<SandboxRuntimeConfig> => {
				const readRoots = [...readOnce, ...sessionReadGrants];
				const writeRoots = [...writeOnce, ...sessionWriteGrants];
				const fresh = loadConfig(cwd).filesystem ?? { denyRead: [], allowWrite: [], denyWrite: [] };
				return {
					filesystem: sandboxFilesystem(
						{ ...fresh, allowRead: [...(fresh.allowRead ?? []), ...readRoots], allowWrite: [...fresh.allowWrite, ...writeRoots] },
						{ cwd, home: homedir() },
					),
				};
			};

			const uid = process.getuid?.() ?? 0;
			const piTmp = `${existsSync("/private/tmp") ? "/private/tmp" : "/tmp"}/pi-${uid}`;

			const grantedWriteFolders = new Set<string>();
			const grantedWriteFiles = new Set<string>();
			const attempt = async (writeOnce: string[]): Promise<{ exitCode: number | null }> => {
				const cfg = loadConfig(cwd);
				const allowLocalhost = cfg.allowLocalhost ?? cfg.network?.allowLocalhost ?? true;
				let bridges: HostPortBridge[] = [];
				if (!allowLocalhost && process.platform === "linux") {
					const hostPorts = cfg.bridgeHostPorts ?? [3274];
					bridges = await startHostPortBridges(hostPorts);
				}
				const rawWrapped = await SandboxManager.wrapWithSandbox(command, undefined, buildCustom(writeOnce));
				let wrappedCommand = rawWrapped;
				if (process.platform === "linux") {
					if (allowLocalhost) {
						wrappedCommand = wrappedCommand.replace(" --unshare-net ", " ");
					} else if (bridges.length > 0) {
						wrappedCommand = injectBridgesIntoBwrap(wrappedCommand, bridges);
					}
				}

				const cleanupBridges = () => {
					bridges.forEach((b) => b.close());
				};

				return new Promise((resolve, reject) => {
					const child = spawn("bash", ["-c", wrappedCommand], {
						cwd,
						detached: true,
						stdio: ["ignore", "pipe", "pipe"],
						env: { ...process.env, TMPDIR: `${piTmp}/` },
					});

					let timedOut = false;
					let timeoutHandle: NodeJS.Timeout | undefined;

					if (timeout !== undefined && timeout > 0) {
						timeoutHandle = setTimeout(() => {
							timedOut = true;
							if (child.pid) {
								try {
									process.kill(-child.pid, "SIGKILL");
								} catch {
									child.kill("SIGKILL");
								}
							}
						}, timeout * 1000);
					}

					let outputTail = "";
					const captureOut = (chunk: Buffer | string) => {
						outputTail = (outputTail + chunk.toString()).slice(-2048);
						onData(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
					};
					child.stdout?.on("data", captureOut);
					child.stderr?.on("data", captureOut);

					child.on("error", (err) => {
						if (timeoutHandle) clearTimeout(timeoutHandle);
						cleanupBridges();
						SandboxManager.cleanupAfterCommand();
						reject(err);
					});

					const onAbort = () => {
						cleanupBridges();
						if (child.pid) {
							try {
								process.kill(-child.pid, "SIGKILL");
							} catch {
								child.kill("SIGKILL");
							}
						}
					};

					signal?.addEventListener("abort", onAbort, { once: true });

					child.on("close", async (code) => {
						if (timeoutHandle) clearTimeout(timeoutHandle);
						signal?.removeEventListener("abort", onAbort);
						cleanupBridges();

						SandboxManager.cleanupAfterCommand();

						let offending: string | undefined;
						let spelledOffending: string | undefined;
						let readDenied = false;
						let writeDenied = false;
						let hardDenied = false;
						let hardWhy = "";
						let outsideDenied = false;
						let outsideMode: "allow" | "ask" | "deny" = "allow";
						let blockedHint = "";
						let sandboxSetupError = false;
						if (isBlockedAccessError(outputTail)) {
							sandboxSetupError = /(^|\n)\s*bwrap:/i.test(outputTail);
							spelledOffending = extractBlockedPath(outputTail, cwd, homedir());
							offending = spelledOffending ? canonicalize(spelledOffending, cwd) : undefined;
							writeDenied = isWriteBlockError(outputTail);
							if (offending) {
								const fsCfg = loadConfig(cwd).filesystem;
								if (fsCfg) {
									const denyReadPat = fsCfg.denyRead.find((pat) => matchesPolicyPattern(offending as string, pat, cwd, homedir()));
									const denyWritePat = writeDenied ? fsCfg.denyWrite.find((pat) => matchesPolicyPattern(offending as string, pat, cwd, homedir())) : undefined;
									hardDenied = denyReadPat !== undefined || denyWritePat !== undefined;
									hardWhy = denyReadPat ? `denyRead matched "${denyReadPat}"` : denyWritePat ? `denyWrite matched "${denyWritePat}"` : "";
									outsideDenied = !writeDenied && outsideProjectReadDenied(offending, cwd, homedir(), fsCfg);
									outsideMode = outsideProjectMode(fsCfg);
								}
								readDenied = hardDenied || outsideDenied;
							}
							let reason = "writes outside allowWrite are read-only";
							if (hardDenied) reason = hardWhy;
							else if (outsideDenied) reason = "target is outside the project directory";
							blockedHint = `\n[Security Policy Notice] filesystem access blocked by sandbox policy: ${writeDenied ? "Write" : "Read"} access to ${offending ?? "target"} is restricted.\nReason: ${reason}. Inform the user; do not attempt workarounds.\n`;
						} else {
							const loopback = attributeLoopbackFailure({
								code,
								output: outputTail,
								command,
								allowLocalhost,
								platform: process.platform,
								bridgedPorts: bridges.map((b) => b.port),
							});
							if (loopback.blocked) {
								const endpointInfo = loopback.endpoint;
								const endpointStr = endpointInfo?.port ? `${endpointInfo.host}:${endpointInfo.port}` : (endpointInfo?.host ?? "127.0.0.1");
								const serviceName = endpointInfo?.service;

								auditL1({
									subject: endpointStr,
									decision: "loopback-refused",
									reason: "Network namespace isolates host loopback under current policy",
									cwd: opts?.ctx?.cwd,
									note: serviceName ? `service:${serviceName}` : undefined,
								});

								const notifyMsg = serviceName
									? `Local network notice: connection to ${serviceName} (${endpointStr}) was blocked by security policy.`
									: `Local network notice: connection to host ${endpointStr} was blocked by security policy.`;
								opts?.ctx?.ui?.notify?.(notifyMsg, "warning");

								blockedHint = `\n[Security Policy Notice] Connection to ${endpointStr}${serviceName ? ` (${serviceName})` : ""} blocked by sandbox policy.\nReason: Local network connections are restricted. Inform the user; do not attempt workarounds.\n`;
							}
						}
						/**
						 * Emit the block explanation only when the command is not re-run with a
						 * grant. After an allow the model must not read a stale "blocked /
						 * waiting for your decision" message and try the command again.
						 */
						const emitBlockedHint = (): void => {
							if (!blockedHint) return;
							onData(Buffer.from(blockedHint));
							blockedHint = "";
						};

						const writeGrantParent = offending ? dirname(offending) : undefined;
						const writeGrantRepeated = offending !== undefined && (grantedWriteFolders.has(dirname(offending)) || grantedWriteFiles.has(offending));

						let decisionHint = "";
						if (sandboxSetupError && !hardDenied && !outsideDenied && (!offending || offending === cwd || offending.startsWith(`${cwd}/`))) {
							blockedHint = "";
							auditL1({ subject: offending ?? spelledOffending, decision: "write-denied", reason: "the OS sandbox could not start (bwrap mount setup)", cwd: opts?.ctx?.cwd, note: "sandbox-setup-error" });
							opts?.ctx?.ui?.notify?.(`Sandbox setup notice: could not prepare folder isolation for ${offending ?? spelledOffending ?? "the sandbox"}. System defaults will be used.`, "warning");
							decisionHint = `\n[System Error] sandbox: the OS sandbox could not start (bwrap could not create a protected mount point), so nothing was permission-prompted. This is a sandbox setup problem, not a policy denial.\n`;
							onData(Buffer.from(decisionHint));
						} else if (offending && outsideDenied && !hardDenied && outsideMode === "ask" && opts?.ctx?.hasUI && opts.ctx.ui?.select && opts.onAlwaysRead) {
							const absPath = offending;
							let askError: unknown;
							try {
								const ui = opts.ctx as AskCtx;
								const parent = dirname(absPath);
								const folder = isSafeFolderGrant(parent, homedir()) ? parent : null;
								const { choice, grant } = await askMainWithRemember(
									ui,
									"Let this command read a file outside your project?",
									[`File     ${absPath}`, ...linkRow(absPath, spelledOffending), `Command  ${command}`, `Why      outside your project, not on your allowed list`].join("\n"),
									{ session: true },
									() => askRememberFile(ui, "Always allow reading \u2014 what, and where?", [`File     ${absPath}`, ...linkRow(absPath, spelledOffending), `Folder   ${parent}/`, `Note     the rule works for any command, not just ${firstWord(command)}`].join("\n"), absPath, folder, { icon: "save", untrusted: !projectTrusted(cwd) }),
								);
								if (choice === MainChoice.Once || choice === MainChoice.Session) {
									if (choice === MainChoice.Once) readOnce.push(absPath);
									else sessionReadGrants.push(absPath);
									auditL1({ subject: absPath, decision: choice, scope: choice === MainChoice.Once ? "invocation" : "session", cwd: opts.ctx.cwd, note: "outside-project-read" });
									opts.ctx.ui?.notify?.(`sandbox: allowed read of ${absPath} ${choice === MainChoice.Once ? "once" : "for this conversation"}`, "info");
									onData(Buffer.from(`\n[Permission Granted] sandbox: read of ${absPath} allowed ${choice === MainChoice.Once ? "once" : "for this conversation"}. Command output with the new permission follows.\n`));
									resolve(attempt([]));
									return;
								}
								if (choice === MainChoice.Remember && grant) {
									const subject = grant.folder ? parent : absPath;
									try {
										const persistedTo = await opts.onAlwaysRead(subject, grant.scope);
										auditL1({ subject, granularity: grant.folder ? "folder" : "file", original: absPath, decision: grant.scope === "cwd" ? "always-cwd" : "always-global", scope: grant.scope, cwd: opts.ctx.cwd, persisted_to: persistedTo, note: "outside-project-read" });
										opts.ctx.ui?.notify?.(`sandbox: allowed read of ${subject} (${grant.scope}${grant.folder ? ", folder" : ""})`, "info");
										onData(Buffer.from(`\n[Permission Granted] sandbox: read of ${subject} allowed (${grant.scope}${grant.folder ? ", folder" : ""}). Command output with the new permission follows.\n`));
										resolve(attempt([]));
										return;
									} catch (e) {
										auditL1({ subject, scope: grant.scope, cwd: opts.ctx.cwd, error: String(e), note: "outside-project-read" });
										decisionHint = `\n[Security Notice] sandbox: could not save the permission (${e}). ${subject} remains blocked.\n`;
									}
								}
							} catch (e) {
								askError = e;
							}
							if (!decisionHint) {
								auditL1({
									subject: absPath,
									decision: "no",
									note: askError ? "ask-error" : "outside-project-read-denied",
									...(askError ? { error: String(askError) } : {}),
									cwd: opts.ctx.cwd,
								});
								decisionHint = `\n${blockedLine("Read", "outside the project", "read")}\n`;
							}
							onData(Buffer.from(decisionHint));
						} else if (offending && readDenied) {
							const why = hardDenied ? hardWhy : "outside the project";
							const action: "Read" | "Write" = writeDenied ? "Write" : "Read";
							const outcome = action === "Write" ? "written" : "read";
							auditL1({ subject: offending, decision: readDenied && !writeDenied ? "read-denied" : "write-denied", reason: why, cwd });
							opts?.ctx?.ui?.notify?.(`Folder protected: unable to ${action.toLowerCase()} ${offending}. Location is restricted under current policy.`, "warning");
							decisionHint = `\n${blockedLine(action, why, outcome)}\n`;
							onData(Buffer.from(decisionHint));
						} else if (offending && writeGrantRepeated && writeGrantParent) {
							auditL1({ subject: offending, decision: "write-denied", reason: `grant for ${writeGrantParent} did not take effect`, cwd: opts?.ctx?.cwd, note: "grant-ineffective" });
							const targetFolder = (writeGrantParent || offending || "").replace(/\/EROFS$/i, "");
							opts?.ctx?.ui?.notify?.(`🚧  Folder protected: unable to write to ${targetFolder} under sandbox policy. Review sandbox.json or /permission-mode.`, "warning");
							decisionHint = `\n${blockedLine("Write", `the grant for ${writeGrantParent} did not take effect`, "written")}\n`;
							onData(Buffer.from(decisionHint));
						} else if (offending && opts?.ctx?.hasUI && opts.ctx.ui?.select && opts.onAlways) {
							const absPath = offending;
							const parentDir = dirname(absPath);
							const alreadyGranted = writeOnce.includes(parentDir) || sessionWriteGrants.includes(parentDir);
							let askError: unknown;
							try {
								const ui = opts.ctx as AskCtx;
								const folder = isSafeFolderGrant(parentDir, homedir()) ? parentDir : null;
								const deniedWhy = writeDenied ? "not under an allowWrite root" : "blocked by the sandbox filesystem policy";
								const { choice, grant } = await askMainWithRemember(
									ui,
									`Let ${firstWord(command)} save files in ${parentDir}/?`,
									[`File     ${absPath}`, ...linkRow(absPath, spelledOffending), `Command  ${command}`, `Why      ${deniedWhy}`].join("\n"),
									{ session: true, once: !alreadyGranted },
									() => askRememberFile(ui, "Always allow saving \u2014 what, and where?", [`File     ${absPath}`, ...linkRow(absPath, spelledOffending), `Folder   ${parentDir}/`, `Note     the rule works for any command, not just ${firstWord(command)}`].join("\n"), absPath, folder, { icon: "save", untrusted: !projectTrusted(cwd) }),
								);
								if (choice === MainChoice.Once) {
									grantedWriteFolders.add(parentDir);
									auditL1({ subject: absPath, granularity: "folder", original: absPath, decision: "once", scope: "invocation", cwd: opts.ctx.cwd, note: "write-once" });
									opts.ctx.ui?.notify?.(`sandbox: allowed write to ${absPath} once`, "info");
									onData(Buffer.from(`\n[Permission Granted] sandbox: write to ${absPath} allowed once. Command output with the new permission follows.\n`));
									resolve(attempt([...writeOnce, parentDir]));
									return;
								}
								if (choice === MainChoice.Session) {
									const value = isSafeFolderGrant(parentDir, homedir()) ? parentDir : absPath;
									sessionWriteGrants.push(value);
									(value === parentDir ? grantedWriteFolders : grantedWriteFiles).add(value);
									auditL1({ subject: value, granularity: value === parentDir ? "folder" : "file", original: absPath, decision: "session", scope: "session", cwd: opts.ctx.cwd, note: "write-session" });
									opts.ctx.ui?.notify?.(`sandbox: allowed write to ${value} for this conversation`, "info");
									onData(Buffer.from(`\n[Permission Granted] sandbox: write to ${value} allowed for this conversation. Command output with the new permission follows.\n`));
									resolve(attempt([]));
									return;
								}
								if (choice === MainChoice.Remember && grant) {
									const subject = grant.folder ? parentDir : absPath;
									try {
										const persistedTo = await opts.onAlways(subject, grant.scope);
										(grant.folder ? grantedWriteFolders : grantedWriteFiles).add(subject);
										auditL1({ subject, granularity: grant.folder ? "folder" : "file", original: absPath, decision: grant.scope === "cwd" ? "always-cwd" : "always-global", scope: grant.scope, cwd: opts.ctx.cwd, persisted_to: persistedTo });
										opts.ctx.ui?.notify?.(`sandbox: allowed write to ${subject} (${grant.scope}${grant.folder ? ", folder" : ""})`, "info");
										onData(Buffer.from(`\n[Permission Granted] sandbox: write to ${subject} allowed (${grant.scope}${grant.folder ? ", folder" : ""}). Command output with the new permission follows.\n`));
										resolve(attempt([]));
										return;
									} catch (e) {
										auditL1({ subject, granularity: grant.folder ? "folder" : "file", original: absPath, scope: grant.scope, cwd: opts.ctx.cwd, error: String(e) });
										opts.ctx.ui?.notify?.(`sandbox: could not save the permission (${e})`, "error");
										decisionHint = `\n[Security Notice] sandbox: could not save the permission (${e}). ${subject} remains blocked.\n`;
									}
								}
							} catch (e) {
								askError = e;
							}
							if (!decisionHint) {
								auditL1({
									subject: absPath,
									decision: "no",
									note: askError ? "ask-error" : "user-denied",
									...(askError ? { error: String(askError) } : {}),
									cwd: opts.ctx.cwd,
								});
								decisionHint = `\n${blockedLine("Write", askError ? "the permission prompt failed" : "user denied", "written")}\n`;
							}
							onData(Buffer.from(decisionHint));
						} else if (offending && writeDenied) {
							auditL1({ subject: offending, decision: "write-denied", reason: "not under any allowWrite root", cwd });
							opts?.ctx?.ui?.notify?.(`Folder protected: unable to write to ${offending}. Location is outside allowed project folders.`, "warning");
							onData(Buffer.from(`\n${blockedLine("Write", "not under any allowWrite root", "written")}\n`));
						}

						emitBlockedHint();
						if (signal?.aborted) {
							reject(new Error("aborted"));
						} else if (timedOut) {
							reject(new Error(`timeout:${timeout}`));
						} else {
							resolve({ exitCode: code });
						}
					});
				});
			};

			beginNetworkCommand();
			try {
				return await attempt([]);
			} finally {
				endNetworkCommand();
			}
		},
	};
}
