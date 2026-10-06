/**
 * Sandbox Extension - OS-level sandboxing for bash commands
 *
 * Uses @anthropic-ai/sandbox-runtime to enforce filesystem and network
 * restrictions on bash commands at the OS level (sandbox-exec on macOS,
 * bubblewrap on Linux).
 *
 * Note: this example intentionally overrides the built-in `bash` tool to show
 * how built-in tools can be replaced. Alternatively, you could sandbox `bash`
 * via `tool_call` input mutation without replacing the tool.
 *
 * Config files (merged, project takes precedence):
 * - ~/.pi/agent/extensions/sandbox.json (global)
 * - <cwd>/.pi/sandbox.json (project-local)
 *
 * Example .pi/sandbox.json:
 * ```json
 * {
 *   "enabled": true,
 *   "network": {
 *     "allowedDomains": ["github.com", "*.github.com"],
 *     "deniedDomains": []
 *   },
 *   "filesystem": {
 *     "denyRead": ["~/.ssh", "~/.aws"],
 *     "allowWrite": [".", "/tmp"],
 *     "denyWrite": [".env"]
 *   }
 * }
 * ```
 *
 * Usage:
 * - `pi` - sandbox enabled with default/config settings (secure by default)
 * - `pi --yolo` - disable all security layers (visible warning banner)
 * - `pi --no-sandbox` - alias for --yolo (hidden, for backwards compat)
 * - `/sandbox` - show current sandbox configuration
 *
 * Setup:
 * 1. Copy sandbox/ directory to ~/.pi/agent/extensions/
 * 2. Run `npm install` in ~/.pi/agent/extensions/sandbox/
 *
 * Linux also requires: bubblewrap, socat, ripgrep
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type BashOperations, createBashTool, getAgentDir } from "@earendil-works/pi-coding-agent";
import { extractBlockedPath, isSafeFolderGrant, matchesPolicyPattern, outsideProjectMode, outsideProjectReadDenied, readPolicyForUpdate, sandboxFilesystem, DEFAULT_DENY_READ, DEFAULT_DENY_WRITE, DEFAULT_ALLOW_WRITE } from "../lib/guard-lib";
import { applyUntrustedProject, isProjectFileTrusted, recordProjectTrust } from "../lib/project-trust";

interface SandboxFilesystem extends NonNullable<SandboxRuntimeConfig["filesystem"]> {
	/** Layer 2 ONLY (model tools); kept here so both layers share one config shape. */
	modelDenyRead?: string[];
	/** Reads outside the project (ADR-012). Layer 1 enforces it via sandboxFilesystem(). */
	outsideProject?: { read?: "allow" | "ask" | "deny"; allowRead?: string[] };
}

interface SandboxConfig extends Omit<SandboxRuntimeConfig, "filesystem"> {
	enabled?: boolean;
	filesystem?: SandboxFilesystem;
	/**
	 * Additive project-local overrides written by the ask-tier prompts (Layer 1
	 * writes allowWrite/allowRead; Layer 2 shares the same file). Read by
	 * loadConfig() and folded into filesystem.allowWrite / allowRead /
	 * network.allowedDomains so the OS-level sandbox honors them.
	 */
	overrides?: {
		allowRead?: string[];
		allowWrite?: string[];
		allowDomains?: string[];
	};
}

const DEFAULT_CONFIG: SandboxConfig = {
	enabled: true,
	network: {
		allowedDomains: [
			"npmjs.org",
			"*.npmjs.org",
			"registry.npmjs.org",
			"registry.yarnpkg.com",
			"pypi.org",
			"*.pypi.org",
			"github.com",
			"*.github.com",
			"api.github.com",
			"raw.githubusercontent.com",
		],
		deniedDomains: [],
	},
	filesystem: {
		denyRead: [...DEFAULT_DENY_READ],
		allowWrite: [...DEFAULT_ALLOW_WRITE],
		denyWrite: [...DEFAULT_DENY_WRITE],
	},
};

const TRUST_STORE = join(getAgentDir(), "extensions", "sandbox.trust.json");
/** Set at session_start: the user declined pi's own project-trust prompt. */
let piDeclinedTrust = false;

/** A project sandbox.json applies in full only when its content was trusted (ADR-013). */
function projectTrusted(cwd: string): boolean {
	return !piDeclinedTrust && isProjectFileTrusted(join(cwd, ".pi", "sandbox.json"), TRUST_STORE);
}

function loadConfig(cwd: string): SandboxConfig {
	const projectConfigPath = join(cwd, ".pi", "sandbox.json");
	const globalConfigPath = join(getAgentDir(), "extensions", "sandbox.json");

	let globalConfig: Partial<SandboxConfig> = {};
	let projectConfig: Partial<SandboxConfig> = {};

	if (existsSync(globalConfigPath)) {
		try {
			globalConfig = JSON.parse(readFileSync(globalConfigPath, "utf-8"));
		} catch (e) {
			console.error(`Warning: Could not parse ${globalConfigPath}: ${e}`);
		}
	}

	if (existsSync(projectConfigPath)) {
		try {
			projectConfig = JSON.parse(readFileSync(projectConfigPath, "utf-8"));
		} catch (e) {
			console.error(`Warning: Could not parse ${projectConfigPath}: ${e}`);
		}
	}

	const base = deepMerge(DEFAULT_CONFIG, globalConfig);
	// An untrusted project file may only tighten the sandbox: no enabled:false,
	// no allowWrite / allowedDomains / overrides, no ignoreViolations or
	// enableWeakerNestedSandbox, and its deny lists are added, not substituted.
	let merged: SandboxConfig;
	if (existsSync(projectConfigPath) && !projectTrusted(cwd)) {
		const baseRec = /* SAFETY: SandboxConfig is parsed JSON, readable as a plain record. */ base as unknown as Record<string, unknown>;
		const projectRec = /* SAFETY: project sandbox.json is parsed JSON. */ projectConfig as unknown as Record<string, unknown>;
		merged = /* SAFETY: applyUntrustedProject returns the same shape it was handed. */ applyUntrustedProject(baseRec, projectRec).merged as unknown as SandboxConfig;
	} else {
		merged = deepMerge(base, projectConfig);
	}
	return foldOverrides(merged);
}

/**
 * Fold an additive `overrides` section into the regular allowWrite /
 * allowedDomains arrays so SandboxManager (which doesn't know about
 * `overrides`) sees a flat config. Idempotent.
 */
function foldOverrides(config: SandboxConfig): SandboxConfig {
	const overrides = config.overrides;
	if (!overrides) return config;
	const out: SandboxConfig = {
		...config,
		filesystem: config.filesystem
			? { ...config.filesystem }
			: { denyRead: [], allowWrite: [], denyWrite: [] },
		network: config.network ? { ...config.network } : { allowedDomains: [], deniedDomains: [] },
	};
	if (overrides.allowWrite?.length) {
		out.filesystem!.allowWrite = [
			...(out.filesystem!.allowWrite ?? []),
			...overrides.allowWrite,
		];
	}
	// Fold read grants too: an ask-tier "always" for an outside bash read
	// re-exposes it via filesystem.allowRead (ADR-014). This cannot unmask a
	// secret: the absolute-deny tier refuses "always" for credentials, and
	// sandbox-runtime keeps explicit file denies winning over a directory
	// allowRead.
	if (overrides.allowRead?.length) {
		out.filesystem!.allowRead = [
			...(out.filesystem!.allowRead ?? []),
			...overrides.allowRead,
		];
	}
	if (overrides.allowDomains?.length) {
		out.network!.allowedDomains = [
			...(out.network!.allowedDomains ?? []),
			...overrides.allowDomains,
		];
	}
	return out;
}

function deepMerge(base: SandboxConfig, overrides: Partial<SandboxConfig>): SandboxConfig {
	const result: SandboxConfig = { ...base };

	if (overrides.enabled !== undefined) result.enabled = overrides.enabled;
	if (overrides.network) {
		result.network = { ...base.network, ...overrides.network };
	}
	if (overrides.filesystem) {
		result.filesystem = { ...base.filesystem, ...overrides.filesystem };
	}
	if (overrides.overrides) {
		result.overrides = {
			allowRead: [...(base.overrides?.allowRead ?? []), ...(overrides.overrides.allowRead ?? [])],
			allowWrite: [...(base.overrides?.allowWrite ?? []), ...(overrides.overrides.allowWrite ?? [])],
			allowDomains: [...(base.overrides?.allowDomains ?? []), ...(overrides.overrides.allowDomains ?? [])],
		};
	}

	const extOverrides = overrides as {
		ignoreViolations?: Record<string, string[]>;
		enableWeakerNestedSandbox?: boolean;
	};
	const extResult = result as { ignoreViolations?: Record<string, string[]>; enableWeakerNestedSandbox?: boolean };

	if (extOverrides.ignoreViolations) {
		extResult.ignoreViolations = extOverrides.ignoreViolations;
	}
	if (extOverrides.enableWeakerNestedSandbox !== undefined) {
		extResult.enableWeakerNestedSandbox = extOverrides.enableWeakerNestedSandbox;
	}

	return result;
}

function createSandboxedBashOps(opts?: {
	ctx?: { cwd: string; hasUI?: boolean; ui?: { select?: (t: string, o: string[], op?: { timeout?: number }) => Promise<string | undefined>; notify?: (m: string, l?: string) => void } };
	onAlways?: (absPath: string, scope: "cwd" | "global") => Promise<string>;
	onAlwaysRead?: (absPath: string, scope: "cwd" | "global") => Promise<string>;
}): BashOperations {
	return {
		async exec(command, cwd, { onData, signal, timeout }) {
			if (!existsSync(cwd)) {
				throw new Error(`Working directory does not exist: ${cwd}`);
			}

			const wrappedCommand = await SandboxManager.wrapWithSandbox(command);

			const uid = process.getuid?.() ?? 0;
			const piTmp = `/private/tmp/pi-${uid}`;

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
								hardDenied = fsCfg.denyRead.some((pat) => matchesPolicyPattern(offending as string, pat, cwd, homedir()));
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
						const title = `Layer 1 (bash sandbox) blocked a read outside the project:\n  ${absPath}\n\nAllow future bash reads of this file?`;
						const NO = "no  — leave blocked (default)";
						const CWD_FILE = "always for CURRENT project — allow this file (.pi/sandbox.json)";
						const ALL_FILE = "always for ALL projects — allow this file (~/.pi/agent/extensions/sandbox.json)";
						const options = [NO, CWD_FILE, ALL_FILE];
						try {
							const chosen = await opts.ctx.ui.select(title, options, { timeout: 60_000 });
							const ts = new Date().toISOString();
							const auditPath = `${getAgentDir()}/audit.log`;
							let scope: "cwd" | "global" | null = null;
							if (chosen === CWD_FILE) scope = "cwd";
							else if (chosen === ALL_FILE) scope = "global";
							if (scope) {
								try {
									const persistedTo = await opts.onAlwaysRead(absPath, scope);
									appendFileSync(auditPath, `${JSON.stringify({ ts, layer: 1, tool: "bash", subject: absPath, decision: scope === "cwd" ? "always-cwd" : "always-global", scope, cwd: opts.ctx.cwd, persisted_to: persistedTo, note: "outside-project-read" })}\n`);
									opts.ctx.ui?.notify?.(`pi-sandbox: allowed read of ${absPath} (${scope}) — retry the bash command`, "warning");
									decisionHint = `\n✅ pi-sandbox: ${absPath} now allowed (${scope}). Retry the bash command.\n`;
								} catch (e) {
									appendFileSync(auditPath, `${JSON.stringify({ ts, layer: 1, tool: "bash", subject: absPath, scope, cwd: opts.ctx.cwd, error: String(e), note: "outside-project-read" })}\n`);
									decisionHint = `\n❌ pi-sandbox: failed to apply override (${e}). Path remains blocked.\n`;
								}
							} else {
								appendFileSync(auditPath, `${JSON.stringify({ ts, layer: 1, tool: "bash", subject: absPath, decision: "no", cwd: opts.ctx.cwd, note: "outside-project-read" })}\n`);
								decisionHint = `\n❌ pi-sandbox: read outside the project denied. Do not retry; ask the user how to proceed.\n`;
							}
						} catch {
							/* prompt failure shouldn't crash bash */
						}
						if (decisionHint) onData(Buffer.from(decisionHint));
					} else if (offending && readDenied) {
						const why = hardDenied ? "denyRead" : "outside the project";
						appendFileSync(`${getAgentDir()}/audit.log`, `${JSON.stringify({ ts: new Date().toISOString(), layer: 1, tool: "bash", subject: offending, decision: "read-denied", reason: why, cwd })}\n`);
						opts?.ctx?.ui?.notify?.(`pi-sandbox: bash was refused a read of ${offending} (${why}). Edit sandbox.json if that is wrong.`, "warning");
						decisionHint = `\n❌ pi-sandbox: reading ${offending} from bash is blocked by policy (${why}). Do not retry or work around it; ask the user.\n`;
						onData(Buffer.from(decisionHint));
					} else if (offending && opts?.ctx?.hasUI && opts.ctx.ui?.select && opts.onAlways) {
						const absPath = offending;
						const title = `Layer 1 (bash sandbox) blocked a write to:\n  ${absPath}\n\nAllow future bash commands to write here?`;
						const parentDir = dirname(absPath);
						// "no" first and pre-selected. Never offer /, the home folder or above as a folder grant.
						const folderOk = isSafeFolderGrant(parentDir, homedir());
						const NO = "no  — leave blocked (default)";
						const CWD_FILE = "always for CURRENT project — whitelist this file (.pi/sandbox.json)";
						const CWD_DIR = `always for CURRENT project — whitelist parent folder ${parentDir} (.pi/sandbox.json)`;
						const ALL_FILE = "always for ALL projects — whitelist this file (~/.pi/agent/extensions/sandbox.json)";
						const ALL_DIR = `always for ALL projects — whitelist parent folder ${parentDir} (~/.pi/agent/extensions/sandbox.json)`;
						const options = folderOk ? [NO, CWD_FILE, CWD_DIR, ALL_FILE, ALL_DIR] : [NO, CWD_FILE, ALL_FILE];
						try {
							const chosen = await opts.ctx.ui.select(title, options, { timeout: 60_000 });
							const ts = new Date().toISOString();
							const auditPath = `${getAgentDir()}/audit.log`;
							const scope: "cwd" | "global" | null =
								chosen === CWD_FILE || chosen === CWD_DIR ? "cwd"
								: chosen === ALL_FILE || chosen === ALL_DIR ? "global"
								: null;
							const useParent = chosen === CWD_DIR || chosen === ALL_DIR;
							const subject = useParent ? parentDir : absPath;
							if (scope) {
								try {
									const persistedTo = await opts.onAlways(subject, scope);
									appendFileSync(auditPath, `${JSON.stringify({ ts, layer: 1, tool: "bash", subject, granularity: useParent ? "folder" : "file", original: absPath, decision: scope === "cwd" ? "always-cwd" : "always-global", scope, cwd: opts.ctx.cwd, persisted_to: persistedTo })}\n`);
									opts.ctx.ui?.notify?.(`pi-sandbox: allowed ${subject} (${scope}${useParent ? ", folder" : ""}) — retry the bash command`, "warning");
									decisionHint = `\n✅ pi-sandbox: ${subject} now allowed (${scope}${useParent ? ", folder" : ""}). Retry the bash command.\n`;
								} catch (e) {
									appendFileSync(auditPath, `${JSON.stringify({ ts, layer: 1, tool: "bash", subject, granularity: useParent ? "folder" : "file", original: absPath, decision: scope === "cwd" ? "always-cwd" : "always-global", scope, cwd: opts.ctx.cwd, error: String(e) })}\n`);
									opts.ctx.ui?.notify?.(`pi-sandbox: failed to apply override (${e})`, "error");
									decisionHint = `\n❌ pi-sandbox: failed to apply override (${e}). Path remains blocked.\n`;
								}
							} else {
								appendFileSync(auditPath, `${JSON.stringify({ ts, layer: 1, tool: "bash", subject: absPath, decision: "no", cwd: opts.ctx.cwd })}\n`);
								decisionHint = `\n❌ pi-sandbox: user denied. ${absPath} remains blocked. Do not retry; ask the user how to proceed.\n`;
							}
						} catch {
							/* prompt failure shouldn't crash bash */
						}
						if (decisionHint) onData(Buffer.from(decisionHint));
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

export default function (pi: ExtensionAPI) {
	pi.registerFlag("yolo", {
		description: "Disable all pi security layers (no-sandbox, no in-process guard, no browser gate). Use with caution.",
		type: "boolean",
		default: false,
	});

	// Backwards compat alias
	pi.registerFlag("no-sandbox", {
		description: "(Deprecated) alias for --yolo. Use --yolo instead.",
		type: "boolean",
		default: false,
	});

	const localCwd = process.cwd();
	const localBash = createBashTool(localCwd);

	let sandboxEnabled = false;
	let sandboxInitialized = false;
	let activeCtx: { cwd: string; hasUI?: boolean; ui?: { select?: (t: string, o: string[], op?: { timeout?: number }) => Promise<string | undefined>; notify?: (m: string, l?: string) => void } } | undefined;

	/** Persist an "always" Layer 1 override (scope: cwd or global) and live-reload SandboxManager. */
	async function persistLayer1Override(kind: "allowWrite" | "allowRead", absPath: string, scope: "cwd" | "global"): Promise<string> {
		const { dir, path } =
			scope === "cwd"
				? { dir: join(localCwd, ".pi"), path: join(localCwd, ".pi", "sandbox.json") }
				: { dir: join(getAgentDir(), "extensions"), path: join(getAgentDir(), "extensions", "sandbox.json") };
		// Never write a grant into an untrusted project file: recording the new hash
		// would trust whatever else is in it.
		if (scope === "cwd" && !projectTrusted(localCwd)) {
			throw new Error(`${path} is not trusted; run /security trust first, or choose an "ALL projects" option`);
		}
		// Throws on an unparseable file: never overwrite a hand-written policy we could not read.
		const existing = readPolicyForUpdate(path) as { overrides?: { allowWrite?: string[]; allowRead?: string[] } };
		const overrides = existing.overrides ?? {};
		const list = overrides[kind] ?? [];
		if (!list.includes(absPath)) list.push(absPath);
		overrides[kind] = list;
		existing.overrides = overrides;
		mkdirSync(dir, { recursive: true });
		writeFileSync(path, `${JSON.stringify(existing, null, 2)}\n`);
		if (scope === "cwd") recordProjectTrust(path, TRUST_STORE);
		await reloadSandbox();
		return path;
	}
	const persistAndReload = (absPath: string, scope: "cwd" | "global") => persistLayer1Override("allowWrite", absPath, scope);
	const persistAndReloadRead = (absPath: string, scope: "cwd" | "global") => persistLayer1Override("allowRead", absPath, scope);

	async function reloadSandbox(): Promise<void> {
		if (!sandboxInitialized) return;
		const config = loadConfig(localCwd);
		try {
			await SandboxManager.reset();
		} catch {
			/* ignore */
		}
		await SandboxManager.initialize({
			network: config.network,
			filesystem: config.filesystem
				? sandboxFilesystem(config.filesystem, { cwd: localCwd, home: homedir() })
				: { denyRead: [], allowRead: [], allowWrite: [], denyWrite: [], disabled: true },
			ignoreViolations: config.ignoreViolations,
			enableWeakerNestedSandbox: config.enableWeakerNestedSandbox,
		});
	}

	pi.registerTool({
		...localBash,
		label: "bash (sandboxed)",
		async execute(id, params, signal, onUpdate, _ctx) {
			if (!sandboxEnabled || !sandboxInitialized) {
				return localBash.execute(id, params, signal, onUpdate);
			}

			const sandboxedBash = createBashTool(localCwd, {
				operations: createSandboxedBashOps({ ctx: activeCtx, onAlways: persistAndReload, onAlwaysRead: persistAndReloadRead }),
			});
			return sandboxedBash.execute(id, params, signal, onUpdate);
		},
	});

	pi.on("user_bash", () => {
		if (!sandboxEnabled || !sandboxInitialized) return;
		return { operations: createSandboxedBashOps({ ctx: activeCtx, onAlways: persistAndReload, onAlwaysRead: persistAndReloadRead }) };
	});

	pi.on("session_start", async (_event, ctx) => {
		activeCtx = /* SAFETY: pi's runtime ctx carries cwd/hasUI/ui; the local type only names the fields we use. */ ctx as unknown as typeof activeCtx;
		piDeclinedTrust = (ctx as { isProjectTrusted?: () => boolean }).isProjectTrusted?.() === false;
		const yolo = pi.getFlag("yolo") as boolean;
		const noSandbox = pi.getFlag("no-sandbox") as boolean; // backwards compat

		if (yolo || noSandbox) {
			sandboxEnabled = false;
			ctx.ui.setStatus(
				"sandbox",
				ctx.ui.theme.fg("error", "⚠️  YOLO — security layers disabled"),
			);
			ctx.ui.notify(
				"⚠️  YOLO mode — all pi security layers disabled for this session.\n" +
				"   Layer 1 (bash sandbox): OFF\n" +
				"   Layer 2 (in-process guard): OFF\n" +
				"   Layer 3 (subagent stricter): OFF\n" +
				"   Layer 4 (browser gate): OFF\n" +
				"   You can now do anything, including reading secrets and writing system paths.",
				"error",
			);
			return;
		}

		const config = loadConfig(ctx.cwd);

		if (!config.enabled) {
			sandboxEnabled = false;
			ctx.ui.notify("Sandbox disabled via config", "info");
			return;
		}

		const platform = process.platform;
		if (platform !== "darwin" && platform !== "linux") {
			sandboxEnabled = false;
			ctx.ui.notify(`Sandbox not supported on ${platform}`, "warning");
			return;
		}

		try {
			await SandboxManager.initialize({
				network: config.network,
				// Strip pi-only fields (modelDenyRead, _comment_*) so SandboxManager
				// doesn't see keys it doesn't understand; modelDenyRead is enforced by
				// Layer 2 (security-guard.ts). sandboxFilesystem() also adds the
				// outside-project fence when filesystem.outsideProject.read gates reads.
				filesystem: config.filesystem
					? sandboxFilesystem(config.filesystem, { cwd: ctx.cwd, home: homedir() })
					: { denyRead: [], allowRead: [], allowWrite: [], denyWrite: [], disabled: true },
				ignoreViolations: config.ignoreViolations,
				enableWeakerNestedSandbox: config.enableWeakerNestedSandbox,
			});

			sandboxEnabled = true;
			sandboxInitialized = true;

			const networkCount = config.network?.allowedDomains?.length ?? 0;
			const writeCount = config.filesystem?.allowWrite?.length ?? 0;
			ctx.ui.setStatus(
				"sandbox",
				ctx.ui.theme.fg("accent", `🔒 Sandbox: ${networkCount} domains, ${writeCount} write paths`),
			);
			ctx.ui.notify("Sandbox initialized", "info");
		} catch (err) {
			sandboxEnabled = false;
			ctx.ui.notify(`Sandbox initialization failed: ${err instanceof Error ? err.message : err}`, "error");
		}
	});

	pi.on("session_shutdown", async () => {
		if (sandboxInitialized) {
			try {
				await SandboxManager.reset();
			} catch {
				// Ignore cleanup errors
			}
		}
	});

	pi.registerCommand("sandbox", {
		description: "Show sandbox configuration. `/sandbox reload` to reload after manual edits to sandbox.json.",
		handler: async (args, ctx) => {
			const sub = (args ?? "").trim().toLowerCase();
			if (sub === "reload") {
				if (!sandboxEnabled || !sandboxInitialized) {
					ctx.ui.notify("Sandbox is disabled — nothing to reload", "info");
					return;
				}
				try {
					await reloadSandbox();
					ctx.ui.notify("🔄 Sandbox reloaded from disk (global + project sandbox.json)", "info");
				} catch (e) {
					ctx.ui.notify(`Sandbox reload failed: ${e instanceof Error ? e.message : e}`, "error");
				}
				return;
			}
			if (!sandboxEnabled) {
				ctx.ui.notify("Sandbox is disabled", "info");
				return;
			}

			const config = loadConfig(ctx.cwd);
			const lines = [
				"Sandbox Configuration:",
				"",
				"Network:",
				`  Allowed: ${config.network?.allowedDomains?.join(", ") || "(none)"}`,
				`  Denied: ${config.network?.deniedDomains?.join(", ") || "(none)"}`,
				"",
				"Filesystem:",
				`  Deny Read: ${config.filesystem?.denyRead?.join(", ") || "(none)"}`,
				`  Allow Read: ${config.filesystem?.allowRead?.join(", ") || "(none)"}`,
				`  Allow Write: ${config.filesystem?.allowWrite?.join(", ") || "(none)"}`,
				`  Deny Write: ${config.filesystem?.denyWrite?.join(", ") || "(none)"}`,
				`  Outside project reads: ${config.filesystem?.outsideProject?.read ?? "allow"}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
