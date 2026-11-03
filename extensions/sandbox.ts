import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import {
	clearFilesystemSessionGrants,
	createSandboxedBashOps,
	filesystemSessionGrantSummary,
} from "../src/l1-sandbox/bash-ops.ts";
import {
	applyNetworkGrant,
	initSandbox,
	persistLayer1Override,
	reloadSandbox,
	resetSandbox,
	writeNetworkOverride,
} from "../src/l1-sandbox/manager.ts";
import {
	clearNetworkSessionGrants,
	type NetworkAskCtx,
	type NetworkAskDeps,
} from "../src/l1-sandbox/network-ask.ts";
import { loadConfig, projectTrusted, setPiDeclinedTrust, type SandboxConfig } from "../src/l1-sandbox/config.ts";
import { audit } from "../src/shared/audit.ts";
import { onDomainGrant } from "../src/shared/network-grants.ts";
import { emitYolo, onYolo, registerYoloFlags, yoloFromFlags, YOLO_STATUS } from "../src/shared/yolo.ts";

async function reloadSandboxConfiguration(
	context: ExtensionContext,
	workingDirectory: string,
	networkDependencies: NetworkAskDeps,
): Promise<void> {
	try {
		await reloadSandbox(workingDirectory, networkDependencies);
		context.ui.notify("🔄 Sandbox reloaded from disk (global + project sandbox.json)", "info");
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		context.ui.notify(`Sandbox reload failed: ${errorMessage}`, "error");
	}
}

function formatSandboxConfiguration(config: SandboxConfig): string {
	const network = config.network;
	const filesystem = config.filesystem;

	return [
		"Sandbox Configuration:",
		"",
		"Network:",
		`  Allowed: ${network?.allowedDomains?.join(", ") || "(none)"}`,
		`  Denied: ${network?.deniedDomains?.join(", ") || "(none)"}`,
		"",
		"Filesystem:",
		`  Deny Read: ${filesystem?.denyRead?.join(", ") || "(none)"}`,
		`  Allow Read: ${filesystem?.allowRead?.join(", ") || "(none)"}`,
		`  Allow Write: ${filesystem?.allowWrite?.join(", ") || "(none)"}`,
		`  Deny Write: ${filesystem?.denyWrite?.join(", ") || "(none)"}`,
		`  Outside project reads: ${filesystem?.outsideProject?.read ?? "allow"}`,
		`  Conversation grants: ${filesystemSessionGrantSummary() || "(none)"}`,
	].join("\n");
}

export default function (pi: ExtensionAPI) {
	registerYoloFlags(pi);

	onDomainGrant(pi.events, applyNetworkGrant);

	const initialWorkingDirectory = process.cwd();
	const localBashTool = createBashTool(initialWorkingDirectory);

	let isSandboxEnabled = false;
	let isSandboxInitialized = false;
	let isRuntimeYolo = false;
	let sandboxStartingPromise: Promise<void> | null = null;
	let latestExtensionContext: ExtensionContext | undefined;
	let latestBashCommand: string | undefined;

	let activeUiContext: {
		cwd: string;
		hasUI?: boolean;
		ui?: {
			select?: (title: string, options: string[], opts?: { timeout?: number }) => Promise<string | undefined>;
			notify?: (message: string, level?: string) => void;
		};
	} | undefined;

	const createNetworkDependencies = (currentWorkingDirectory: string): NetworkAskDeps => ({
		cwd: currentWorkingDirectory,
		getCtx: () =>
			/* SAFETY: pi's runtime ctx carries ui.select/ui.notify; the local type names only the members used. */
			activeUiContext as unknown as NetworkAskCtx | undefined,
		persist: (host, scope) => writeNetworkOverride(currentWorkingDirectory, host, scope),
		applyLive: applyNetworkGrant,
		audit,
		get projectTrusted() {
			return projectTrusted(currentWorkingDirectory);
		},
		get command() {
			return latestBashCommand;
		},
	});

	const persistAndReloadWrite = (absolutePath: string, scope: "cwd" | "global") =>
		persistLayer1Override(
			initialWorkingDirectory,
			"allowWrite",
			absolutePath,
			scope,
			createNetworkDependencies(initialWorkingDirectory),
		);

	const persistAndReloadRead = (absolutePath: string, scope: "cwd" | "global") =>
		persistLayer1Override(
			initialWorkingDirectory,
			"allowRead",
			absolutePath,
			scope,
			createNetworkDependencies(initialWorkingDirectory),
		);

	const stopSandbox = async (): Promise<void> => {
		isSandboxEnabled = false;

		if (!isSandboxInitialized) {
			return;
		}

		isSandboxInitialized = false;
		await resetSandbox();
	};

	const startSandbox = async (context: ExtensionContext): Promise<void> => {
		if (isRuntimeYolo || (isSandboxEnabled && isSandboxInitialized)) {
			return;
		}

		const config = loadConfig(context.cwd);

		if (!config.enabled) {
			isSandboxEnabled = false;
			context.ui.notify("Sandbox disabled via config", "info");
			return;
		}

		const platform = process.platform;

		if (platform !== "darwin" && platform !== "linux") {
			isSandboxEnabled = false;
			context.ui.notify(`Sandbox not supported on ${platform}`, "warning");
			return;
		}

		try {
			await initSandbox(context.cwd, config, createNetworkDependencies(context.cwd));

			isSandboxEnabled = true;
			isSandboxInitialized = true;

			const allowedDomainCount = config.network?.allowedDomains?.length ?? 0;
			const allowedWritePathCount = config.filesystem?.allowWrite?.length ?? 0;
			const isAdvancedSecureMode = config.mode === "advanced-secure";
			const modeIcon = isAdvancedSecureMode ? "🧠" : "🔒";
			const statusThemeColor = isAdvancedSecureMode ? "success" : "accent";

			context.ui.setStatus(
				"sandbox",
				context.ui.theme.fg(
					statusThemeColor,
					`Sandbox: ${modeIcon}  ${allowedDomainCount} domains, ${allowedWritePathCount} paths`,
				),
			);

			context.ui.notify("Sandbox initialized", "info");
		} catch (error) {
			isSandboxEnabled = false;
			const errorMessage = error instanceof Error ? error.message : String(error);
			context.ui.notify(`Sandbox initialization failed: ${errorMessage}`, "error");
		}
	};

	onYolo(pi.events, (enabled) => {
		if (enabled === isRuntimeYolo) {
			return;
		}

		isRuntimeYolo = enabled;
		const context = latestExtensionContext;

		if (!context) {
			return;
		}

		if (!enabled) {
			sandboxStartingPromise = startSandbox(context).finally(() => {
				sandboxStartingPromise = null;
			});
			return;
		}

		void stopSandbox().then(() => {
			context.ui.setStatus("sandbox", context.ui.theme.fg("error", YOLO_STATUS));
		});
	});

	pi.registerTool({
		...localBashTool,
		label: "bash (sandboxed)",
		async execute(id, params, signal, onUpdate, _ctx) {
			if (!isRuntimeYolo && sandboxStartingPromise) {
				await sandboxStartingPromise;
			}

			if (isRuntimeYolo || !isSandboxEnabled || !isSandboxInitialized) {
				return localBashTool.execute(id, params, signal, onUpdate);
			}

			const sandboxedBash = createBashTool(initialWorkingDirectory, {
				operations: createSandboxedBashOps({
					ctx: activeUiContext,
					onAlways: persistAndReloadWrite,
					onAlwaysRead: persistAndReloadRead,
				}),
			});

			return sandboxedBash.execute(id, params, signal, onUpdate);
		},
	});

	pi.on("user_bash", async () => {
		if (!isRuntimeYolo && sandboxStartingPromise) {
			await sandboxStartingPromise;
		}

		if (isRuntimeYolo || !isSandboxEnabled || !isSandboxInitialized) {
			return;
		}

		return {
			operations: createSandboxedBashOps({
				ctx: activeUiContext,
				onAlways: persistAndReloadWrite,
				onAlwaysRead: persistAndReloadRead,
			}),
		};
	});

	pi.on("tool_call", (event, _ctx) => {
		if (event.toolName === "bash") {
			const input = event.input as { command?: string };

			if (typeof input.command === "string") {
				latestBashCommand = input.command;
			}
		}
	});

	pi.on("session_start", async (_event, context) => {
		latestExtensionContext = context;
		activeUiContext =
			/* SAFETY: pi's runtime ctx carries cwd/hasUI/ui; the local type only names the fields we use. */
			context as unknown as typeof activeUiContext;

		clearNetworkSessionGrants();
		clearFilesystemSessionGrants();

		setPiDeclinedTrust((context as { isProjectTrusted?: () => boolean }).isProjectTrusted?.() === false);

		isRuntimeYolo = yoloFromFlags(pi) || loadConfig(context.cwd).mode === "yolo";
		emitYolo(pi.events, isRuntimeYolo);

		if (isRuntimeYolo) {
			await stopSandbox();
			context.ui.setStatus("sandbox", context.ui.theme.fg("error", YOLO_STATUS));
			context.ui.notify(
				context.ui.theme.fg("error", "🚨  YOLO mode — all pi security layers disabled."),
				"info",
			);
			return;
		}

		await startSandbox(context);
	});

	pi.on("session_shutdown", async () => {
		if (isSandboxInitialized) {
			await resetSandbox();
		}
	});

	pi.registerCommand("sandbox", {
		description: "Show sandbox configuration. `/sandbox reload` to reload after manual edits to sandbox.json.",
		handler: async (args, context) => {
			const subcommand = (args ?? "").trim().toLowerCase();

			if (subcommand === "reload") {
				if (!isSandboxEnabled || !isSandboxInitialized) {
					context.ui.notify("Sandbox is disabled — nothing to reload", "info");
					return;
				}

				await reloadSandboxConfiguration(
					context,
					initialWorkingDirectory,
					createNetworkDependencies(initialWorkingDirectory),
				);
				return;
			}

			if (!isSandboxEnabled) {
				context.ui.notify("Sandbox is disabled", "info");
				return;
			}

			const config = loadConfig(context.cwd);
			context.ui.notify(formatSandboxConfiguration(config), "info");
		},
	});
}
