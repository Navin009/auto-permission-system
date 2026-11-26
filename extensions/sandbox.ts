import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import {
	clearFilesystemSessionGrants,
	createSandboxedBashOps,
	filesystemSessionGrantSummary,
} from "#l1-sandbox/bash-ops.ts";
import {
	applyNetworkGrant,
	initSandbox,
	persistLayer1Override,
	reloadSandbox,
	resetSandbox,
	writeNetworkOverride,
} from "#l1-sandbox/manager.ts";
import { clearNetworkSessionGrants, type NetworkAskCtx, type NetworkAskDeps } from "#l1-sandbox/network-ask.ts";
import { loadConfig, projectTrusted, setPiDeclinedTrust, type SandboxConfig } from "#l1-sandbox/config.ts";
import { audit } from "#shared/audit.ts";
import { onDomainGrant } from "#shared/network-grants.ts";
import { sandboxStatusChip } from "#shared/sandbox-status.ts";
import { emitYolo, onYolo, registerYoloFlags, yoloFromFlags, YOLO_STATUS } from "#shared/yolo.ts";
import { POLICY_NOTICE } from "#shared/messages.ts";

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

	let currentWorkingDirectory = process.cwd();
	const localBashTool = createBashTool(process.cwd());

	let isSandboxEnabled = false;
	let isSandboxInitialized = false;
	let isRuntimeYolo = false;
	let sandboxBlockReason: string | undefined;
	let sandboxStartingPromise: Promise<void> | null = null;
	let latestExtensionContext: ExtensionContext | undefined;
	let latestBashCommand: string | undefined;
	let latestBashToolCallId: string | undefined;

	let activeUiContext:
		| {
				cwd: string;
				hasUI?: boolean;
				ui?: {
					select?: (title: string, options: string[], opts?: { timeout?: number }) => Promise<string | undefined>;
					notify?: (message: string, level?: string) => void;
				};
		  }
		| undefined;

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
		getToolCallId: () => latestBashToolCallId,
	});

	const persistAndReloadWrite = (absolutePath: string, scope: "cwd" | "global") =>
		persistLayer1Override(
			currentWorkingDirectory,
			"allowWrite",
			absolutePath,
			scope,
			createNetworkDependencies(currentWorkingDirectory),
		);

	const persistAndReloadRead = (absolutePath: string, scope: "cwd" | "global") =>
		persistLayer1Override(
			currentWorkingDirectory,
			"allowRead",
			absolutePath,
			scope,
			createNetworkDependencies(currentWorkingDirectory),
		);

	const stopSandbox = async (): Promise<void> => {
		isSandboxEnabled = false;

		if (!isSandboxInitialized) {
			return;
		}

		isSandboxInitialized = false;
		await resetSandbox();
	};

	const readSandboxConfig = (context: ExtensionContext): SandboxConfig | undefined => {
		try {
			return loadConfig(context.cwd);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			context.ui.notify(`Sandbox initialization failed: ${errorMessage}`, "error");
			return undefined;
		}
	};

	const startSandbox = async (context: ExtensionContext, loadedConfig?: SandboxConfig): Promise<void> => {
		if (isRuntimeYolo || (isSandboxEnabled && isSandboxInitialized)) {
			return;
		}

		const config = loadedConfig ?? readSandboxConfig(context);

		if (!config) {
			isSandboxEnabled = false;
			sandboxBlockReason = "the sandbox configuration could not be read";
			return;
		}

		if (!config.enabled) {
			isSandboxEnabled = false;
			sandboxBlockReason = "the sandbox is disabled in sandbox.json";
			context.ui.notify("Sandbox disabled via config", "info");
			return;
		}

		const platform = process.platform;

		if (platform !== "darwin" && platform !== "linux") {
			isSandboxEnabled = false;
			sandboxBlockReason = `the sandbox is not supported on ${platform}`;
			context.ui.notify(`Sandbox not supported on ${platform}`, "warning");
			return;
		}

		try {
			await initSandbox(context.cwd, config, createNetworkDependencies(context.cwd));

			isSandboxEnabled = true;
			isSandboxInitialized = true;
			sandboxBlockReason = undefined;

			const chip = sandboxStatusChip(config);

			context.ui.setStatus("sandbox", context.ui.theme.fg(chip.color, chip.text));

			context.ui.notify("Sandbox initialized", "info");
		} catch (error) {
			isSandboxEnabled = false;
			const errorMessage = error instanceof Error ? error.message : String(error);
			sandboxBlockReason = `the sandbox failed to start (${errorMessage})`;
			context.ui.notify(`Sandbox initialization failed: ${errorMessage}`, "error");
		}
	};

	onYolo(pi.events, (enabled) => {
		if (enabled === isRuntimeYolo) {
			return;
		}

		const context = latestExtensionContext;

		if (enabled && !yoloFromFlags(pi) && loadConfig(context?.cwd ?? currentWorkingDirectory).mode !== "yolo") {
			audit({ layer: 1, event: "yolo-emit-ignored", cwd: context?.cwd });
			return;
		}

		isRuntimeYolo = enabled;

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

			const sandboxedBash = createBashTool(currentWorkingDirectory, {
				operations: createSandboxedBashOps({
					toolCallId: id,
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
		if (event.toolName !== "bash") {
			return;
		}

		if (!isRuntimeYolo && sandboxBlockReason) {
			return {
				block: true,
				reason: `${POLICY_NOTICE} bash was blocked because ${sandboxBlockReason}, and an unsandboxed shell would bypass every file and network rule. Nothing was run. Fix the sandbox config, or start pi with --yolo to run without one.`,
			};
		}

		const input = event.input as { command?: string };

		latestBashToolCallId = event.toolCallId;

		if (typeof input.command === "string") {
			latestBashCommand = input.command;
		}
	});

	pi.on("tool_result", (event) => {
		if (event.toolName === "bash") {
			latestBashCommand = undefined;
			latestBashToolCallId = undefined;
		}
	});

	pi.on("session_start", async (_event, context) => {
		latestExtensionContext = context;
		currentWorkingDirectory = context.cwd;
		activeUiContext =
			/* SAFETY: pi's runtime ctx carries cwd/hasUI/ui; the local type only names the fields we use. */
			context as unknown as typeof activeUiContext;

		clearNetworkSessionGrants();
		clearFilesystemSessionGrants();

		setPiDeclinedTrust((context as { isProjectTrusted?: () => boolean }).isProjectTrusted?.() === false);

		const flagYolo = yoloFromFlags(pi);
		const config = readSandboxConfig(context);

		isRuntimeYolo = flagYolo || config?.mode === "yolo";
		emitYolo(pi.events, isRuntimeYolo);

		if (isRuntimeYolo) {
			await stopSandbox();
			context.ui.setStatus("sandbox", context.ui.theme.fg("error", YOLO_STATUS));
			context.ui.notify("🚨  YOLO mode — all pi security layers disabled.", "warning");
			return;
		}

		if (!config) {
			isSandboxEnabled = false;
			return;
		}

		await startSandbox(context, config);
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
					currentWorkingDirectory,
					createNetworkDependencies(currentWorkingDirectory),
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
