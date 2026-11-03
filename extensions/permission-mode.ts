import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { modeLabel, normalizeMode, setPolicyMode, type PermissionMode } from "../src/core/index.ts";
import { loadConfig } from "../src/l1-sandbox/config.ts";
import { loadPolicy } from "../src/l2-guard/policy.ts";
import { audit } from "../src/shared/audit.ts";
import { emitYolo, onYolo, YOLO_STATUS } from "../src/shared/yolo.ts";

const GLOBAL_POLICY_PATH = `${getAgentDir()}/extensions/sandbox.json`;
const SELECTION_TIMEOUT_MILLISECONDS = 120_000;
const MODE_LABEL_COLUMN_WIDTH = 26;

interface ModeDefinition {
	value: PermissionMode;
	icon: string;
	name: string;
	description: string;
}

const MODE_DEFINITIONS: ModeDefinition[] = [
	{
		value: "advanced-secure",
		icon: "🧠",
		name: "Advanced Secure",
		description: "Blocks sensitive data leaks from file reads, MCP tools & command outputs",
	},
	{
		value: "default",
		icon: "🔒",
		name: "Default",
		description: "Restricts file paths & network access at the sandbox level",
	},
	{
		value: "yolo",
		icon: "🚨",
		name: "YOLO",
		description: "Turns off all file sandboxing and leak protections",
	},
];

function renderSandboxChip(context: ExtensionContext): void {
	const config = loadConfig(context.cwd);

	if (normalizeMode(config.mode) === "yolo") {
		context.ui.setStatus("sandbox", context.ui.theme.fg("error", YOLO_STATUS));
		return;
	}

	if (!config.enabled) {
		return;
	}

	const isSecureMode = config.mode === "advanced-secure";
	const allowedDomainCount = config.network?.allowedDomains?.length ?? 0;
	const allowedPathCount = config.filesystem?.allowWrite?.length ?? 0;
	const modeIcon = isSecureMode ? "🧠" : "🔒";
	const chipText = `Sandbox: ${modeIcon}  ${allowedDomainCount} domains, ${allowedPathCount} paths`;

	context.ui.setStatus("sandbox", context.ui.theme.fg(isSecureMode ? "success" : "accent", chipText));
}

function modeNotice(mode: PermissionMode): { text: string; level: "info" | "warning" } {
	if (mode === "yolo") {
		return {
			text: "🚨  YOLO — all security layers disabled. Saved; new conversations start this way too.",
			level: "warning",
		};
	}

	if (mode === "advanced-secure") {
		return {
			text: "🧠 Advanced Secure on. File reads, MCP calls, and tool output are checked for secrets.",
			level: "info",
		};
	}

	return {
		text: "🛡 Default mode. Rule-based policy only.",
		level: "info",
	};
}

async function pickMode(
	pi: ExtensionAPI,
	context: ExtensionContext,
	yoloState: { active: boolean },
): Promise<void> {
	const currentMode: PermissionMode = yoloState.active
		? "yolo"
		: normalizeMode(loadPolicy(context.cwd).mode);

	const options = MODE_DEFINITIONS.map((definition) => {
		const isActive = definition.value === currentMode;
		const nameWithStatus = isActive ? `${definition.name} (active)` : definition.name;
		const labelColumn = nameWithStatus.padEnd(MODE_LABEL_COLUMN_WIDTH);

		return `${definition.icon}  ${labelColumn} —  ${definition.description}`;
	});

	const pickedOption = await context.ui.select(
		"Select permission mode:",
		options,
		{ timeout: SELECTION_TIMEOUT_MILLISECONDS },
	);

	if (pickedOption === undefined) {
		return;
	}

	const pickedIndex = options.indexOf(pickedOption);
	const nextMode = pickedIndex >= 0 ? MODE_DEFINITIONS[pickedIndex].value : currentMode;

	if (nextMode === currentMode) {
		if (nextMode === "yolo" && !yoloState.active) {
			yoloState.active = true;
			emitYolo(pi.events, true);

			audit({
				layer: 0,
				event: "permission-mode",
				mode: "yolo",
				cwd: context.cwd,
				note: "runtime-sync",
			});

			renderSandboxChip(context);
			context.ui.notify("🚨  YOLO — all security layers disabled for this conversation.", "warning");
			return;
		}

		context.ui.notify(`Permission mode is already ${modeLabel(nextMode)}.`, "info");
		return;
	}

	try {
		setPolicyMode(GLOBAL_POLICY_PATH, nextMode);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		context.ui.notify(`Could not save the permission mode: ${errorMessage}`, "error");
		return;
	}

	yoloState.active = nextMode === "yolo";
	emitYolo(pi.events, yoloState.active);

	audit({
		layer: 0,
		event: "permission-mode",
		mode: nextMode,
		cwd: context.cwd,
	});

	renderSandboxChip(context);

	const notice = modeNotice(nextMode);
	context.ui.notify(notice.text, notice.level);
}

export default function (pi: ExtensionAPI) {
	const yoloState = { active: false };

	onYolo(pi.events, (enabled) => {
		yoloState.active = enabled;
	});

	pi.registerCommand?.("permission-mode", {
		description: "Choose the permission mode: Default (rules), Advanced Secure (detection), or YOLO (all layers off). Saved to the global sandbox.json.",
		handler: async (_args, context) => pickMode(pi, context, yoloState),
	});
}
