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

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { createSandboxedBashOps } from "../src/l1-sandbox/bash-ops";
import { initSandbox, persistLayer1Override, reloadSandbox, resetSandbox } from "../src/l1-sandbox/manager";
import { loadConfig, setPiDeclinedTrust } from "../src/l1-sandbox/config";
import { emitYolo, onYolo, registerYoloFlags, yoloFromFlags, YOLO_STATUS } from "../src/shared/yolo";

export default function (pi: ExtensionAPI) {
	// pi scopes flags per extension (ADR-020); registering here makes
	// `yoloFromFlags(pi)` below read the real CLI value.
	registerYoloFlags(pi);

	const localCwd = process.cwd();
	const localBash = createBashTool(localCwd);

	let sandboxEnabled = false;
	let sandboxInitialized = false;
	let runtimeYolo = false;
	let sandboxStarting: Promise<void> | null = null;
	let latestCtx: ExtensionContext | undefined;
	let activeCtx: { cwd: string; hasUI?: boolean; ui?: { select?: (t: string, o: string[], op?: { timeout?: number }) => Promise<string | undefined>; notify?: (m: string, l?: string) => void } } | undefined;

	const persistAndReload = (absPath: string, scope: "cwd" | "global") => persistLayer1Override(localCwd, "allowWrite", absPath, scope);
	const persistAndReloadRead = (absPath: string, scope: "cwd" | "global") => persistLayer1Override(localCwd, "allowRead", absPath, scope);

	/** Bring the bash sandbox down; safe when it was never up. */
	const stopSandbox = async (): Promise<void> => {
		sandboxEnabled = false;
		if (!sandboxInitialized) return;
		sandboxInitialized = false;
		await resetSandbox();
	};

	/** Re-read policy and bring the bash sandbox up. No-op while YOLO is on. */
	const startSandbox = async (ctx: ExtensionContext): Promise<void> => {
		if (runtimeYolo || (sandboxEnabled && sandboxInitialized)) return;
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
					`Sandbox: ${secure ? "🧠" : "🔒"}  ${networkCount} domains, ${writeCount} paths`,
				),
			);
			ctx.ui.notify("Sandbox initialized", "info");
		} catch (err) {
			sandboxEnabled = false;
			ctx.ui.notify(`Sandbox initialization failed: ${err instanceof Error ? err.message : err}`, "error");
		}
	};

	// Runtime YOLO from `/permission-mode` (ADR-020): stop or restart the
	// sandbox in place, without a session restart.
	onYolo(pi.events, (enabled) => {
		// The startup broadcast originates here; ignore our own echo.
		if (enabled === runtimeYolo) return;
		runtimeYolo = enabled;
		const ctx = latestCtx;
		if (!ctx) return;
		if (!enabled) {
			// Gate bash until the sandbox is back up, so turning YOLO off cannot
			// leave a window where a command runs unfenced (ADR-020 follow-up).
			sandboxStarting = startSandbox(ctx).finally(() => {
				sandboxStarting = null;
			});
			return;
		}
		void stopSandbox().then(() => {
			ctx.ui.setStatus("sandbox", ctx.ui.theme.fg("error", YOLO_STATUS));
		});
	});

	pi.registerTool({
		...localBash,
		label: "bash (sandboxed)",
		async execute(id, params, signal, onUpdate, _ctx) {
			if (!runtimeYolo && sandboxStarting) await sandboxStarting;
			if (runtimeYolo || !sandboxEnabled || !sandboxInitialized) {
				return localBash.execute(id, params, signal, onUpdate);
			}

			const sandboxedBash = createBashTool(localCwd, {
				operations: createSandboxedBashOps({ ctx: activeCtx, onAlways: persistAndReload, onAlwaysRead: persistAndReloadRead }),
			});
			return sandboxedBash.execute(id, params, signal, onUpdate);
		},
	});

	pi.on("user_bash", async () => {
		if (!runtimeYolo && sandboxStarting) await sandboxStarting;
		if (runtimeYolo || !sandboxEnabled || !sandboxInitialized) return;
		return { operations: createSandboxedBashOps({ ctx: activeCtx, onAlways: persistAndReload, onAlwaysRead: persistAndReloadRead }) };
	});

	pi.on("session_start", async (_event, ctx) => {
		latestCtx = ctx;
		activeCtx = /* SAFETY: pi's runtime ctx carries cwd/hasUI/ui; the local type only names the fields we use. */ ctx as unknown as typeof activeCtx;
		setPiDeclinedTrust((ctx as { isProjectTrusted?: () => boolean }).isProjectTrusted?.() === false);
		runtimeYolo = yoloFromFlags(pi) || loadConfig(ctx.cwd).mode === "yolo";
		// Broadcast before any await: guard.ts consumes this on the same bus to
		// learn YOLO is on (ADR-020).
		emitYolo(pi.events, runtimeYolo);

		if (runtimeYolo) {
			await stopSandbox();
			ctx.ui.setStatus("sandbox", ctx.ui.theme.fg("error", YOLO_STATUS));
			ctx.ui.notify("⚠️  YOLO mode — all pi security layers disabled.", "error");
			return;
		}

		await startSandbox(ctx);
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
