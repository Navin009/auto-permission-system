import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { carriesStreamingThought, carriesVisibleText } from "../src/core/tool-view/message-text.ts";
import { rowKindOf } from "../src/core/tool-view/row-kind.ts";
import {
	readToolViewSettings,
	TOOL_VIEW_SETTINGS_FILE_NAME,
} from "../src/core/tool-view/settings.ts";
import { runToolViewCommand, TOOL_VIEW_COMMAND_NAME } from "../src/tool-view/commands.ts";
import { toolViewRenderers } from "../src/tool-view/renderers.ts";
import {
	closeRowGroup,
	hasLiveRow,
	repaintCurrentRow,
	resetRowGroups,
	setRowPresenceListener,
} from "../src/tool-view/row-groups.ts";
import { setActiveViewMode } from "../src/tool-view/session.ts";
import {
	applyThinkingLabel,
	beginThinking,
	endThinking,
	resetThinking,
	setThinkingRepaint,
} from "../src/tool-view/thinking-clock.ts";

const SETTINGS_FILE_PATH = `${getAgentDir()}/${TOOL_VIEW_SETTINGS_FILE_NAME}`;
const USER_ROLE = "user";

let labelContext: ExtensionContext | undefined;

function applyLabelForRowPresence(hasLiveRowNow: boolean): void {
	if (labelContext) {
		applyThinkingLabel(labelContext, hasLiveRowNow);
	}
}

function reloadViewMode(): void {
	setActiveViewMode(readToolViewSettings(SETTINGS_FILE_PATH).viewMode);
}

function startSession(): void {
	resetRowGroups();
	resetThinking();
	reloadViewMode();
}

export default function (pi: ExtensionAPI) {
	setThinkingRepaint(repaintCurrentRow);
	setRowPresenceListener(applyLabelForRowPresence);
	startSession();

	pi.on("session_start", (_event, context) => {
		labelContext = context;
		startSession();
		applyThinkingLabel(context, hasLiveRow());
	});

	pi.on("turn_end", (event) => {
		endThinking();

		if (carriesVisibleText(event.message)) {
			closeRowGroup();
		}
	});

	pi.on("message_start", (event) => {
		endThinking();

		if (event.message.role === USER_ROLE) {
			closeRowGroup();
		}
	});

	pi.on("message_update", (event) => {
		if (carriesStreamingThought(event.message)) {
			beginThinking();
			return;
		}

		endThinking();
	});

	pi.on("session_shutdown", () => {
		resetRowGroups();
		resetThinking();
	});

	pi.registerToolRenderer?.((toolName, next) => {
		if (rowKindOf(toolName)) {
			return toolViewRenderers(toolName, next());
		}

		closeRowGroup();

		return next();
	});

	pi.registerCommand?.(TOOL_VIEW_COMMAND_NAME, {
		description: "Choose how tool calls are drawn: Compact rows or Pi's own Full output. Display only.",
		handler: async (args, context) => {
			await runToolViewCommand(String(args ?? ""), SETTINGS_FILE_PATH, context);
		},
	});
}
