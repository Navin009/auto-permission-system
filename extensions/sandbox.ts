/**
 * Layer 1 entrypoint — thin pi wiring for the OS-level bash sandbox.
 *
 * All logic lives in `src/l1-sandbox/`:
 *  - `config.ts`   policy loading (sandbox.json)
 *  - `manager.ts`  sandbox-runtime lifecycle + persisted "always" grants
 *  - `bash-ops.ts` the sandboxed bash tool, pre-flight ask, blocked-access hints
 * The pure policy logic is in `src/core/`.
 *
 * Uses @anthropic-ai/sandbox-runtime to enforce filesystem and network
 * restrictions on bash commands at the OS level (sandbox-exec on macOS,
 * bubblewrap on Linux).
 *
 * Config files (merged, project takes precedence):
 * - ~/.pi/agent/extensions/sandbox.json (global)
 * - <cwd>/.pi/sandbox.json (project-local)
 *
 * Usage:
 * - `pi` - sandbox enabled with default/config settings (secure by default)
 * - `pi --yolo` - disable all security layers (visible warning banner)
 * - `pi --no-sandbox` - alias for --yolo (hidden, for backwards compat)
 * - `/sandbox` - show current sandbox configuration
 *
 * Setup:
 * 1. A root `npm install` provides @anthropic-ai/sandbox-runtime.
 * 2. pi loads this file as an extension (see package.json `pi.extensions`).
 *
 * Linux also requires: bubblewrap, socat, ripgrep
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { createSandboxedBashOps } from "../src/l1-sandbox/bash-ops";
import { initSandbox, persistLayer1Override, reloadSandbox, resetSandbox } from "../src/l1-sandbox/manager";
import { loadConfig, setPiDeclinedTrust } from "../src/l1-sandbox/config";

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

	const persistAndReload = (absPath: string, scope: "cwd" | "global") => persistLayer1Override(localCwd, "allowWrite", absPath, scope);
	const persistAndReloadRead = (absPath: string, scope: "cwd" | "global") => persistLayer1Override(localCwd, "allowRead", absPath, scope);

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
		setPiDeclinedTrust((ctx as { isProjectTrusted?: () => boolean }).isProjectTrusted?.() === false);
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
			await initSandbox(ctx.cwd, config);

			sandboxEnabled = true;
			sandboxInitialized = true;

			const networkCount = config.network?.allowedDomains?.length ?? 0;
			const writeCount = config.filesystem?.allowWrite?.length ?? 0;
			const secure = config.mode === "advanced-secure";
			ctx.ui.setStatus(
				"sandbox",
				ctx.ui.theme.fg(
					secure ? "success" : "accent",
					`Sandbox: ${secure ? "☢️" : "🛡️"}\u2002${networkCount} domains, ${writeCount} paths`,
				),
			);
			ctx.ui.notify("Sandbox initialized", "info");
		} catch (err) {
			sandboxEnabled = false;
			ctx.ui.notify(`Sandbox initialization failed: ${err instanceof Error ? err.message : err}`, "error");
		}
	});

	pi.on("session_shutdown", async () => {
		if (sandboxInitialized) {
			await resetSandbox();
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
					await reloadSandbox(localCwd);
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
