import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { ownsTool } from "../src/core/tool-view/labels.ts";
import {
	readToolViewSettings,
	TOOL_VIEW_SETTINGS_FILE_NAME,
} from "../src/core/tool-view/settings.ts";
import { runToolViewCommand, TOOL_VIEW_COMMAND_NAME } from "../src/tool-view/commands.ts";
import { endAllCalls } from "../src/tool-view/live-clock.ts";
import { toolViewRenderers } from "../src/tool-view/renderers.ts";
import { setActiveViewMode } from "../src/tool-view/session.ts";

const SETTINGS_FILE_PATH = `${getAgentDir()}/${TOOL_VIEW_SETTINGS_FILE_NAME}`;

function reloadViewMode(): void {
	setActiveViewMode(readToolViewSettings(SETTINGS_FILE_PATH).viewMode);
}

export default function (pi: ExtensionAPI) {
	reloadViewMode();

	pi.on("session_start", () => {
		reloadViewMode();
	});

	pi.on("session_shutdown", () => {
		endAllCalls();
	});

	pi.registerToolRenderer?.((toolName, next) => {
		if (!ownsTool(toolName)) {
			return next();
		}

		return toolViewRenderers(toolName, next());
	});

	pi.registerCommand?.(TOOL_VIEW_COMMAND_NAME, {
		description: "Switch how tool calls are drawn: /tool-view compact | full. Display only.",
		handler: async (args, context) => {
			await runToolViewCommand(String(args ?? ""), SETTINGS_FILE_PATH, context);
		},
	});
}
