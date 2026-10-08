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
import { askReadCandidates, extractBlockedPath, isBlockedAccessError, isSafeFolderGrant, isWriteBlockError, matchedAskCommands, matchesPolicyPattern, outsideProjectMode, outsideProjectReadCandidates, outsideProjectReadDenied, sandboxFilesystem } from "../core/index";
import { audit } from "../shared/audit";
import { askMain, askRememberFile, type AskCtx } from "../ui/ask-flow";
import { loadConfig } from "./config";
import { beginNetworkCommand, endNetworkCommand } from "./network-ask";

export interface SandboxedBashOpts {
	ctx?: { cwd: string; hasUI?: boolean; ui?: { select?: (t: string, o: string[], op?: { timeout?: number }) => Promise<string | undefined>; notify?: (m: string, l?: string) => void } };
	onAlways?: (absPath: string, scope: "cwd" | "global") => Promise<string>;
	onAlwaysRead?: (absPath: string, scope: "cwd" | "global") => Promise<string>;
}

/** One denial shape for Layer 1, mirroring denyMessage() in Layer 2. */
function blockedLine(action: "Read" | "Write", why: string, outcome: "read" | "written" | "run"): string {
	return `❌ pi-sandbox: ${action} blocked by policy: ${why}. Nothing was ${outcome} — ask the user.`;
}

const auditL1 = (entry: Record<string, unknown>) => audit({ layer: 1, tool: "bash", ...entry });

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
	const body = `  command: ${matched.join(", ")}\n  why:     it can print environment values (API tokens)`;
	const choice = await askMain(ui, "Command may print secrets", body, { once: true, remember: false });
	const subject = matched.join(", ");
	if (choice === "once") {
		auditL1({ subject, decision: "once", note: "sensitive-command", cwd });
		return undefined;
	}
	auditL1({ subject, decision: "no", note: "sensitive-command", cwd });
	onData(Buffer.from(`\n❌ pi-sandbox: command blocked — it can print secrets: ${subject}. Nothing was run — ask the user.\n`));
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
	const paths = askReadCandidates(command, cwd, homedir(), cfg);
	if (!paths.length) return undefined;
	const ui = opts?.ctx as AskCtx | undefined;
	for (const absPath of paths) {
		if (!ui?.hasUI || !ui.ui?.select) {
			auditL1({ subject: absPath, decision: "no", note: "ask-read-headless", cwd });
			onData(Buffer.from(`\n❌ pi-sandbox: sensitive file read blocked: ${absPath}. Nothing was run — ask the user.\n`));
			return { exitCode: 1 };
		}
		const choice = await askMain(ui, "Sensitive file read", `  file:   ${absPath}\n  why:    it may hold secrets`, { remember: false });
		if (choice === "once" || choice === "session") {
			auditL1({ subject: absPath, decision: choice, note: "ask-read", cwd });
			continue;
		}
		auditL1({ subject: absPath, decision: "no", note: "ask-read", cwd });
		onData(Buffer.from(`\n❌ pi-sandbox: sensitive file read blocked: ${absPath}. Nothing was run — ask the user.\n`));
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
	for (const absPath of outsideProjectReadCandidates(command, cwd, homedir(), cfg)) {
		const ui = opts.ctx as AskCtx;
		const main = await askMain(ui, "Read outside the project", `  path:   ${absPath}\n  source: this bash command`);
		if (main === "once") {
			auditL1({ subject: absPath, decision: "once", reason: "outside-project-read", note: "preflight", cwd });
			once.push(absPath);
			continue;
		}
		let subject: string | null = null;
		let scope: "cwd" | "global" = "cwd";
		if (main === "remember") {
			const parent = dirname(absPath);
			const folder = isSafeFolderGrant(parent, homedir()) ? parent : null;
			const picked = await askRememberFile(ui, "Remember this read?", `  file:   ${absPath}\n  folder: ${parent}`, absPath, folder);
			if (picked) {
				subject = picked.folder ? parent : absPath;
				scope = picked.scope;
			}
		}
		if (!subject) {
			auditL1({ subject: absPath, decision: "no", reason: "outside-project-read", note: "preflight", cwd });
			onData(Buffer.from(`\n${blockedLine("Read", "outside the project", "run")}\n`));
			return { blocked: { exitCode: 1 } };
		}
		try {
			const persistedTo = await opts.onAlwaysRead(subject, scope);
			auditL1({ subject, decision: scope === "cwd" ? "always-cwd" : "always-global", scope, cwd, persisted_to: persistedTo, note: "preflight" });
			opts.ctx.ui?.notify?.(`pi-sandbox: allowed read of ${subject} (${scope})`, "warning");
		} catch (e) {
			auditL1({ subject, scope, cwd, error: String(e), note: "preflight" });
			onData(Buffer.from(`\n❌ pi-sandbox: could not save the permission (${e}). ${subject} remains blocked.\n`));
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

			// Commands that can print secrets (tokens in the environment) ask first.
			const sensitive = await preflightSensitiveCommands(command, cwd, opts, onData);
			if (sensitive) return sensitive;

			const askRead = await preflightAskReads(command, cwd, opts, onData);
			if (askRead) return askRead;

			// ADR-015: sandbox-runtime masks a gated directory with an empty tmpfs,
			// so an outside read would otherwise succeed with silently trimmed output
			// and never reach the EPERM post-block hook. Ask before running.
			const pre = await preflightOutsideReads(command, cwd, opts, onData);
			if (pre && "blocked" in pre) return pre.blocked;
			// "this once" grants apply to this one invocation only: hand them to
			// wrapWithSandbox as a customConfig, so nothing is persisted and the
			// session-wide sandbox is not re-initialised.
			const readOnce = pre?.once ?? [];
			const buildCustom = (writeOnce: string[]): Partial<SandboxRuntimeConfig> | undefined => {
				if (!readOnce.length && !writeOnce.length) return undefined;
				const fresh = loadConfig(cwd).filesystem ?? { denyRead: [], allowWrite: [], denyWrite: [] };
				return {
					filesystem: sandboxFilesystem(
						{ ...fresh, allowRead: [...(fresh.allowRead ?? []), ...readOnce], allowWrite: [...fresh.allowWrite, ...writeOnce] },
						{ cwd, home: homedir() },
					),
				};
			};

			const uid = process.getuid?.() ?? 0;
			// macOS has /private/tmp; Linux only /tmp. Either sits in the default
			// allowWrite list, so the sandboxed command can write its scratch files.
			const piTmp = `${existsSync("/private/tmp") ? "/private/tmp" : "/tmp"}/pi-${uid}`;

			// One one-time write grant = one re-run of the same command with that path
			// added to allowWrite, never persisted (mirrors the read pre-flight's
			// customConfig). A path already granted is not offered again, so a command
			// that keeps hitting the same fence cannot loop.
			const attempt = async (writeOnce: string[]): Promise<{ exitCode: number | null }> => {
				const wrappedCommand = await SandboxManager.wrapWithSandbox(command, undefined, buildCustom(writeOnce));

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
						SandboxManager.cleanupAfterCommand();
						reject(err);
					});

					const onAbort = () => {
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

						SandboxManager.cleanupAfterCommand();

						let offending: string | undefined;
						let readDenied = false;
						let writeDenied = false;
						let hardDenied = false;
						let hardWhy = "";
						let outsideDenied = false;
						let outsideMode: "allow" | "ask" | "deny" = "allow";
						if (isBlockedAccessError(outputTail)) {
							// Relative paths resolve against the command's cwd: "./.env" is not "/.env".
							offending = extractBlockedPath(outputTail, cwd, homedir());
							writeDenied = isWriteBlockError(outputTail);
							// A hard denyRead path (secret material): a write grant would not help,
							// and "always" is not offered. The outside-project fence (ADR-014) is
							// ask-able, so keep the two reasons apart.
							if (offending) {
								const fsCfg = loadConfig(cwd).filesystem;
								if (fsCfg) {
									const hardPat = fsCfg.denyRead.find((pat) => matchesPolicyPattern(offending as string, pat, cwd, homedir()));
									hardDenied = hardPat !== undefined;
									hardWhy = hardPat ? `denyRead matched "${hardPat}"` : "denyRead";
									outsideDenied = !writeDenied && outsideProjectReadDenied(offending, cwd, homedir(), fsCfg);
									outsideMode = outsideProjectMode(fsCfg);
								}
								readDenied = hardDenied || outsideDenied;
							}
							const configDirHint = offending && /\.config\/|\.kube\/|\.docker\/|\.netrc|\.aws\/|\.npmrc|\.gitconfig/.test(offending);

							let hint = `\n💡 pi-sandbox: filesystem access blocked.\n`;
							if (offending) {
								let why = "";
								if (writeDenied && !hardDenied) why = " (not under an allowWrite root: writes outside it are read-only)";
								else if (hardDenied) why = " (denyRead: reading it is blocked by policy)";
								else if (outsideDenied) why = " (outside the project: reading it is gated by policy)";
								hint += `   Path: ${offending}${why}\n`;
							}
							hint += `   This is the pi sandbox (Layer 1), NOT macOS Full Disk Access / TCC.\n`;
							if (configDirHint) {
								hint +=
									`   Looks like a tool's own config dir. To allow this tool in the\n` +
									`   current project, add a project-local policy:\n` +
									`     mkdir -p ${cwd}/.pi && cat > ${cwd}/.pi/sandbox.json <<'JSON'\n` +
									`     { "filesystem": { "allowWrite": [".", "${offending?.replace(/^~/, "$HOME") ?? "~/.config/<tool>"}"] } }\n` +
									`     JSON\n` +
									`   Or run pi with --yolo for one-off elevated access (disables ALL layers).\n`;
							} else {
								hint +=
									`   Use $TMPDIR (= ${piTmp}/) for scratch files,\n` +
									`   or write inside the project directory (${cwd}).\n`;
							}
							hint += `   Policy: ~/.pi/agent/extensions/sandbox.json (+ <cwd>/.pi/sandbox.json overrides).\n`;
							if (opts?.ctx?.hasUI && opts.ctx.ui?.select && opts.onAlways && !readDenied) {
								hint += `   → Waiting for your decision in the prompt above before this bash call returns to the model.\n`;
							}
							onData(Buffer.from(hint));
						}

						// Ask-tier prompt: BEFORE resolve so the agent loop pauses while the
						// user decides. Otherwise the model gets the EPERM hint immediately,
						// tries an alternative, and the prompt sits orphaned in the UI.
						let decisionHint = "";
						if (offending && outsideDenied && !hardDenied && outsideMode === "ask" && opts?.ctx?.hasUI && opts.ctx.ui?.select && opts.onAlwaysRead) {
							// ask-tier read grant for a path outside the project (ADR-014).
							const absPath = offending;
							try {
								const ui = opts.ctx as AskCtx;
								const main = await askMain(ui, "Read blocked by policy", `  path:   ${absPath}\n  why:    outside the project\n  layer:  bash sandbox`, { once: false });
								if (main === "remember") {
									const parent = dirname(absPath);
									const folder = isSafeFolderGrant(parent, homedir()) ? parent : null;
									const picked = await askRememberFile(ui, "Remember this read?", `  file:   ${absPath}\n  folder: ${parent}`, absPath, folder);
									if (picked) {
										const subject = picked.folder ? parent : absPath;
										try {
											const persistedTo = await opts.onAlwaysRead(subject, picked.scope);
											auditL1({ subject, granularity: picked.folder ? "folder" : "file", original: absPath, decision: picked.scope === "cwd" ? "always-cwd" : "always-global", scope: picked.scope, cwd: opts.ctx.cwd, persisted_to: persistedTo, note: "outside-project-read" });
											opts.ctx.ui?.notify?.(`pi-sandbox: allowed read of ${subject} (${picked.scope}${picked.folder ? ", folder" : ""}) — retry the bash command`, "warning");
											decisionHint = `\n✅ pi-sandbox: ${subject} now allowed (${picked.scope}${picked.folder ? ", folder" : ""}). Retry the bash command.\n`;
										} catch (e) {
											auditL1({ subject, scope: picked.scope, cwd: opts.ctx.cwd, error: String(e), note: "outside-project-read" });
											decisionHint = `\n❌ pi-sandbox: could not save the permission (${e}). ${subject} remains blocked.\n`;
										}
									}
								}
							} catch {
								/* prompt failure shouldn't crash bash */
							}
							if (!decisionHint) {
								auditL1({ subject: absPath, decision: "no", cwd: opts.ctx.cwd, note: "outside-project-read" });
								decisionHint = `\n${blockedLine("Read", "outside the project", "read")}\n`;
							}
							onData(Buffer.from(decisionHint));
						} else if (offending && readDenied) {
							const why = hardDenied ? hardWhy : "outside the project";
							const action: "Read" | "Write" = writeDenied ? "Write" : "Read";
							const outcome = action === "Write" ? "written" : "read";
							auditL1({ subject: offending, decision: readDenied && !writeDenied ? "read-denied" : "write-denied", reason: why, cwd });
							opts?.ctx?.ui?.notify?.(`pi-sandbox: bash was refused a ${action.toLowerCase()} of ${offending} (${why}). Edit sandbox.json if that is wrong.`, "warning");
							decisionHint = `\n${blockedLine(action, why, outcome)}\n`;
							onData(Buffer.from(decisionHint));
						} else if (offending && opts?.ctx?.hasUI && opts.ctx.ui?.select && opts.onAlways) {
							const absPath = offending;
							const parentDir = dirname(absPath);
							const alreadyGranted = writeOnce.includes(parentDir);
							try {
								const ui = opts.ctx as AskCtx;
								const main = await askMain(ui, "Write blocked by policy", `  path:   ${absPath}\n  why:    not under any allowWrite root\n  layer:  bash sandbox`, { once: !alreadyGranted });
								if (main === "once") {
									auditL1({ subject: absPath, granularity: "folder", original: absPath, decision: "once", scope: "invocation", cwd: opts.ctx.cwd, note: "write-once" });
									opts.ctx.ui?.notify?.(`pi-sandbox: allowed ${absPath} once — re-running the command`, "warning");
									onData(Buffer.from(`\n✅ pi-sandbox: allowed ${absPath} once — re-running the command.\n`));
									resolve(attempt([...writeOnce, parentDir]));
									return;
								}
								if (main === "remember") {
									const folder = isSafeFolderGrant(parentDir, homedir()) ? parentDir : null;
									const picked = await askRememberFile(ui, "Remember this write?", `  file:   ${absPath}\n  folder: ${parentDir}`, absPath, folder);
									if (picked) {
										const subject = picked.folder ? parentDir : absPath;
										try {
											const persistedTo = await opts.onAlways(subject, picked.scope);
											auditL1({ subject, granularity: picked.folder ? "folder" : "file", original: absPath, decision: picked.scope === "cwd" ? "always-cwd" : "always-global", scope: picked.scope, cwd: opts.ctx.cwd, persisted_to: persistedTo });
											opts.ctx.ui?.notify?.(`pi-sandbox: allowed ${subject} (${picked.scope}${picked.folder ? ", folder" : ""}) — retry the bash command`, "warning");
											decisionHint = `\n✅ pi-sandbox: ${subject} now allowed (${picked.scope}${picked.folder ? ", folder" : ""}). Retry the bash command.\n`;
										} catch (e) {
											auditL1({ subject, granularity: picked.folder ? "folder" : "file", original: absPath, scope: picked.scope, cwd: opts.ctx.cwd, error: String(e) });
											opts.ctx.ui?.notify?.(`pi-sandbox: could not save the permission (${e})`, "error");
											decisionHint = `\n❌ pi-sandbox: could not save the permission (${e}). ${subject} remains blocked.\n`;
										}
									}
								}
							} catch {
								/* prompt failure shouldn't crash bash */
							}
							if (!decisionHint) {
								auditL1({ subject: absPath, decision: "no", cwd: opts.ctx.cwd });
								decisionHint = `\n${blockedLine("Write", "user denied", "written")}\n`;
							}
							onData(Buffer.from(decisionHint));
						} else if (offending && writeDenied) {
							// No UI to prompt with: report the fence and the path to the model.
							auditL1({ subject: offending, decision: "write-denied", reason: "not under any allowWrite root", cwd });
							opts?.ctx?.ui?.notify?.(`pi-sandbox: bash was refused a write of ${offending} (not under any allowWrite root).`, "warning");
							onData(Buffer.from(`\n${blockedLine("Write", "not under any allowWrite root", "written")}\n`));
						}

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

			// "Allow once" network grants cover this command's connections to a host;
			// the finally releases them however the command ends (abort/timeout too).
			beginNetworkCommand();
			try {
				return await attempt([]);
			} finally {
				endNetworkCommand();
			}
		},
	};
}
