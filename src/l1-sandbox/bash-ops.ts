/**
 * Layer 1 bash execution: replace the bash child process with one wrapped by
 * sandbox-runtime, pre-flight outside-project reads (ADR-015), and turn a
 * blocked access into an ask-tier prompt + hint.
 *
 * Adapter module: spawns processes and prompts the UI; no policy internals.
 */

import { spawn } from "node:child_process";
import { existsSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { type BashOperations, getAgentDir } from "@earendil-works/pi-coding-agent";
import { extractBlockedPath, isSafeFolderGrant, matchesPolicyPattern, outsideProjectMode, outsideProjectReadCandidates, outsideProjectReadDenied, sandboxFilesystem } from "../core/index";
import { askMain, askRememberFile, type AskCtx } from "../ui/ask-flow";
import { loadConfig } from "./config";

export interface SandboxedBashOpts {
	ctx?: { cwd: string; hasUI?: boolean; ui?: { select?: (t: string, o: string[], op?: { timeout?: number }) => Promise<string | undefined>; notify?: (m: string, l?: string) => void } };
	onAlways?: (absPath: string, scope: "cwd" | "global") => Promise<string>;
	onAlwaysRead?: (absPath: string, scope: "cwd" | "global") => Promise<string>;
}

/**
 * ADR-015 pre-flight: ask about a plainly-named read outside the project BEFORE
 * the command runs, so the OS fence never silently trims the output. Returns a
 * blocked exit result when the user declines (or a grant fails); undefined to
 * proceed and run the command. Obfuscated reads are not detected and fall back
 * to the fence.
 */
/** One denial shape for Layer 1, mirroring denyMessage() in Layer 2. */
function blockedLine(action: "Read" | "Write", why: string, outcome: "read" | "written" | "run"): string {
	return `❌ pi-sandbox: ${action} blocked by policy: ${why}. Nothing was ${outcome} — ask the user.`;
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
		const ts = new Date().toISOString();
		const auditPath = `${getAgentDir()}/audit.log`;
		const main = await askMain(ui, "Read outside the project", `  path:   ${absPath}\n  source: this bash command`);
		if (main === "once") {
			appendFileSync(auditPath, `${JSON.stringify({ ts, layer: 1, tool: "bash", subject: absPath, decision: "once", reason: "outside-project-read", note: "preflight", cwd })}\n`);
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
			appendFileSync(auditPath, `${JSON.stringify({ ts, layer: 1, tool: "bash", subject: absPath, decision: "no", reason: "outside-project-read", note: "preflight", cwd })}\n`);
			onData(Buffer.from(`\n${blockedLine("Read", "outside the project", "run")}\n`));
			return { blocked: { exitCode: 1 } };
		}
		try {
			const persistedTo = await opts.onAlwaysRead(subject, scope);
			appendFileSync(auditPath, `${JSON.stringify({ ts, layer: 1, tool: "bash", subject, decision: scope === "cwd" ? "always-cwd" : "always-global", scope, cwd, persisted_to: persistedTo, note: "preflight" })}\n`);
			opts.ctx.ui?.notify?.(`pi-sandbox: allowed read of ${subject} (${scope})`, "warning");
		} catch (e) {
			appendFileSync(auditPath, `${JSON.stringify({ ts, layer: 1, tool: "bash", subject, scope, cwd, error: String(e), note: "preflight" })}\n`);
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

			// ADR-015: sandbox-runtime masks a gated directory with an empty tmpfs,
			// so an outside read would otherwise succeed with silently trimmed output
			// and never reach the EPERM post-block hook. Ask before running.
			const pre = await preflightOutsideReads(command, cwd, opts, onData);
			if (pre && "blocked" in pre) return pre.blocked;
			// "this once" grants apply to this one invocation only: hand them to
			// wrapWithSandbox as a customConfig, so nothing is persisted and the
			// session-wide sandbox is not re-initialised.
			let custom: Partial<SandboxRuntimeConfig> | undefined;
			if (pre?.once.length) {
				const fresh = loadConfig(cwd).filesystem ?? { denyRead: [], allowWrite: [], denyWrite: [] };
				custom = {
					filesystem: sandboxFilesystem(
						{ ...fresh, allowRead: [...(fresh.allowRead ?? []), ...pre.once] },
						{ cwd, home: homedir() },
					),
				};
			}

			const wrappedCommand = await SandboxManager.wrapWithSandbox(command, undefined, custom);

			const uid = process.getuid?.() ?? 0;
			// macOS has /private/tmp; Linux only /tmp. Either sits in the default
			// allowWrite list, so the sandboxed command can write its scratch files.
			const piTmp = `${existsSync("/private/tmp") ? "/private/tmp" : "/tmp"}/pi-${uid}`;

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

					let offending: string | undefined;
					let readDenied = false;
					let hardDenied = false;
					let hardWhy = "";
					let outsideDenied = false;
					let outsideMode: "allow" | "ask" | "deny" = "allow";
					if (/operation not permitted|EPERM|EACCES/i.test(outputTail)) {
						// Relative paths resolve against the command's cwd: "./.env" is not "/.env".
						offending = extractBlockedPath(outputTail, cwd, homedir());
						// A hard denyRead path (secret material): a write grant would not help,
						// and "always" is not offered. The outside-project fence (ADR-014) is
						// ask-able, so keep the two reasons apart.
						if (offending) {
							const fsCfg = loadConfig(cwd).filesystem;
							if (fsCfg) {
								const hardPat = fsCfg.denyRead.find((pat) => matchesPolicyPattern(offending as string, pat, cwd, homedir()));
								hardDenied = hardPat !== undefined;
								hardWhy = hardPat ? `denyRead matched "${hardPat}"` : "denyRead";
								outsideDenied = outsideProjectReadDenied(offending, cwd, homedir(), fsCfg);
								outsideMode = outsideProjectMode(fsCfg);
							}
							readDenied = hardDenied || outsideDenied;
						}
						const configDirHint = offending && /\.config\/|\.kube\/|\.docker\/|\.netrc|\.aws\/|\.npmrc|\.gitconfig/.test(offending);

						let hint = `\n💡 pi-sandbox: filesystem access blocked.\n`;
						if (offending) {
							let why = "";
							if (hardDenied) why = " (denyRead: reading it is blocked by policy)";
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
									const ts = new Date().toISOString();
									const auditPath = `${getAgentDir()}/audit.log`;
									try {
										const persistedTo = await opts.onAlwaysRead(subject, picked.scope);
										appendFileSync(auditPath, `${JSON.stringify({ ts, layer: 1, tool: "bash", subject, granularity: picked.folder ? "folder" : "file", original: absPath, decision: picked.scope === "cwd" ? "always-cwd" : "always-global", scope: picked.scope, cwd: opts.ctx.cwd, persisted_to: persistedTo, note: "outside-project-read" })}\n`);
										opts.ctx.ui?.notify?.(`pi-sandbox: allowed read of ${subject} (${picked.scope}${picked.folder ? ", folder" : ""}) — retry the bash command`, "warning");
										decisionHint = `\n✅ pi-sandbox: ${subject} now allowed (${picked.scope}${picked.folder ? ", folder" : ""}). Retry the bash command.\n`;
									} catch (e) {
										appendFileSync(auditPath, `${JSON.stringify({ ts, layer: 1, tool: "bash", subject, scope: picked.scope, cwd: opts.ctx.cwd, error: String(e), note: "outside-project-read" })}\n`);
										decisionHint = `\n❌ pi-sandbox: could not save the permission (${e}). ${subject} remains blocked.\n`;
									}
								}
							}
						} catch {
							/* prompt failure shouldn't crash bash */
						}
						if (!decisionHint) {
							appendFileSync(`${getAgentDir()}/audit.log`, `${JSON.stringify({ ts: new Date().toISOString(), layer: 1, tool: "bash", subject: absPath, decision: "no", cwd: opts.ctx.cwd, note: "outside-project-read" })}\n`);
							decisionHint = `\n${blockedLine("Read", "outside the project", "read")}\n`;
						}
						onData(Buffer.from(decisionHint));
					} else if (offending && readDenied) {
						const why = hardDenied ? hardWhy : "outside the project";
						appendFileSync(`${getAgentDir()}/audit.log`, `${JSON.stringify({ ts: new Date().toISOString(), layer: 1, tool: "bash", subject: offending, decision: "read-denied", reason: why, cwd })}\n`);
						opts?.ctx?.ui?.notify?.(`pi-sandbox: bash was refused a read of ${offending} (${why}). Edit sandbox.json if that is wrong.`, "warning");
						decisionHint = `\n${blockedLine("Read", why, "read")}\n`;
						onData(Buffer.from(decisionHint));
					} else if (offending && opts?.ctx?.hasUI && opts.ctx.ui?.select && opts.onAlways) {
						const absPath = offending;
						try {
							const ui = opts.ctx as AskCtx;
							const main = await askMain(ui, "Write blocked by policy", `  path:   ${absPath}\n  why:    not under any allowWrite root\n  layer:  bash sandbox`, { once: false });
							if (main === "remember") {
								const parentDir = dirname(absPath);
								const folder = isSafeFolderGrant(parentDir, homedir()) ? parentDir : null;
								const picked = await askRememberFile(ui, "Remember this write?", `  file:   ${absPath}\n  folder: ${parentDir}`, absPath, folder);
								if (picked) {
									const subject = picked.folder ? parentDir : absPath;
									const ts = new Date().toISOString();
									const auditPath = `${getAgentDir()}/audit.log`;
									try {
										const persistedTo = await opts.onAlways(subject, picked.scope);
										appendFileSync(auditPath, `${JSON.stringify({ ts, layer: 1, tool: "bash", subject, granularity: picked.folder ? "folder" : "file", original: absPath, decision: picked.scope === "cwd" ? "always-cwd" : "always-global", scope: picked.scope, cwd: opts.ctx.cwd, persisted_to: persistedTo })}\n`);
										opts.ctx.ui?.notify?.(`pi-sandbox: allowed ${subject} (${picked.scope}${picked.folder ? ", folder" : ""}) — retry the bash command`, "warning");
										decisionHint = `\n✅ pi-sandbox: ${subject} now allowed (${picked.scope}${picked.folder ? ", folder" : ""}). Retry the bash command.\n`;
									} catch (e) {
										appendFileSync(auditPath, `${JSON.stringify({ ts, layer: 1, tool: "bash", subject, granularity: picked.folder ? "folder" : "file", original: absPath, scope: picked.scope, cwd: opts.ctx.cwd, error: String(e) })}\n`);
										opts.ctx.ui?.notify?.(`pi-sandbox: could not save the permission (${e})`, "error");
										decisionHint = `\n❌ pi-sandbox: could not save the permission (${e}). ${subject} remains blocked.\n`;
									}
								}
							}
						} catch {
							/* prompt failure shouldn't crash bash */
						}
						if (!decisionHint) {
							appendFileSync(`${getAgentDir()}/audit.log`, `${JSON.stringify({ ts: new Date().toISOString(), layer: 1, tool: "bash", subject: absPath, decision: "no", cwd: opts.ctx.cwd })}\n`);
							decisionHint = `\n${blockedLine("Write", "user denied", "written")}\n`;
						}
						onData(Buffer.from(decisionHint));
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
		},
	};
}
