import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isCommandTool } from "../src/core/tool-view/labels.ts";
import { carriesVisibleText } from "../src/core/tool-view/message-text.ts";
import {
	readToolViewSettings,
	TOOL_VIEW_SETTINGS_FILE_NAME,
} from "../src/core/tool-view/settings.ts";
import { closeCommandGroup, resetCommandGroups } from "../src/tool-view/command-groups.ts";
import { runToolViewCommand, TOOL_VIEW_COMMAND_NAME } from "../src/tool-view/commands.ts";
import { toolViewRenderers } from "../src/tool-view/renderers.ts";
import { setActiveViewMode } from "../src/tool-view/session.ts";

const SETTINGS_FILE_PATH = `${getAgentDir()}/${TOOL_VIEW_SETTINGS_FILE_NAME}`;
const USER_ROLE = "user";

function reloadViewMode(): void {
	setActiveViewMode(readToolViewSettings(SETTINGS_FILE_PATH).viewMode);
}

function startSession(): void {
	resetCommandGroups();
	reloadViewMode();
}

export default function (pi: ExtensionAPI) {
	startSession();

	pi.on("session_start", startSession);

	pi.on("turn_end", (event) => {
		if (carriesVisibleText(event.message)) {
			closeCommandGroup();
		}
	});

	pi.on("message_start", (event) => {
		if (event.message.role === USER_ROLE) {
			closeCommandGroup();
		}
	});

	pi.on("session_shutdown", () => {
		resetCommandGroups();
	});

	pi.registerToolRenderer?.((toolName, next) => {
		if (isCommandTool(toolName)) {
			return toolViewRenderers(toolName, next());
		}

		closeCommandGroup();

		return next();
	});

	pi.registerCommand?.(TOOL_VIEW_COMMAND_NAME, {
		description: "Switch how tool calls are drawn: /tool-view compact | full. Display only.",
		handler: async (args, context) => {
			await runToolViewCommand(String(args ?? ""), SETTINGS_FILE_PATH, context);
		},
	});
}
