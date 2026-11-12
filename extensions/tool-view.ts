import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	carriesStreamingThought,
	carriesVisibleText,
} from "../src/core/tool-view/message-text.ts";
import { rowKindOf } from "../src/core/tool-view/row-kind.ts";
import {
	readToolViewSettings,
	TOOL_VIEW_SETTINGS_FILE_NAME,
} from "../src/core/tool-view/settings.ts";
import { runToolViewCommand, TOOL_VIEW_COMMAND_NAME } from "../src/tool-view/commands.ts";
import { toolViewRenderers } from "../src/tool-view/renderers.ts";
import { closeRowGroup, repaintCurrentRow, resetRowGroups } from "../src/tool-view/row-groups.ts";
import { getActiveViewMode, setActiveViewMode, setThoughtsVisibleLookup } from "../src/tool-view/session.ts";
import {
	applyThinkingVisibility,
	resetThinkingVisibility,
} from "../src/tool-view/thinking-visibility.ts";
import { rememberAssistantMessage, resetThoughts } from "../src/tool-view/thought-store.ts";
import { resetNativeThoughts } from "../src/tool-view/native-thought.ts";
import {
	beginThinking,
	endThinking,
	resetThinking,
	setThinkingRepaint,
} from "../src/tool-view/thinking-clock.ts";

const SETTINGS_FILE_PATH = `${getAgentDir()}/${TOOL_VIEW_SETTINGS_FILE_NAME}`;
const USER_ROLE = "user";
const MESSAGE_ENTRY_TYPE = "message";

function reloadViewMode(): void {
	setActiveViewMode(readToolViewSettings(SETTINGS_FILE_PATH).viewMode);
}

function startSession(): void {
	resetRowGroups();
	resetThinking();
	resetThinkingVisibility();
	resetThoughts();
	resetNativeThoughts();
	reloadViewMode();
}

interface SessionContext {
	sessionManager?: { getBranch: () => readonly unknown[] };
}

function rememberSessionThoughts(context: SessionContext): void {
	if (!context.sessionManager) {
		return;
	}

	for (const entry of context.sessionManager.getBranch()) {
		const sessionEntry = entry as { type?: string; message?: unknown };

		if (sessionEntry.type === MESSAGE_ENTRY_TYPE && sessionEntry.message) {
			rememberAssistantMessage(sessionEntry.message);
		}
	}
}

export default function (pi: ExtensionAPI) {
	setThoughtsVisibleLookup(() => pi.getSettings?.().hideThinkingBlock === false);
	setThinkingRepaint(repaintCurrentRow);
	startSession();

	pi.on("session_start", (_event, context) => {
		startSession();
		applyThinkingVisibility(getActiveViewMode(), context.ui);
		rememberSessionThoughts(context);
	});

	pi.on("turn_end", (event) => {
		endThinking();
		rememberAssistantMessage(event.message);

		if (carriesVisibleText(event.message)) {
			closeRowGroup();
		}
	});

	pi.on("message_start", (event) => {
		endThinking();
		rememberAssistantMessage(event.message);

		if (event.message.role === USER_ROLE) {
			closeRowGroup();
		}
	});

	pi.on("message_update", (event) => {
		rememberAssistantMessage(event.message);

		if (carriesStreamingThought(event.message)) {
			beginThinking();
			return;
		}

		endThinking();

		if (carriesVisibleText(event.message)) {
			closeRowGroup();
		}
	});

	pi.on("session_shutdown", () => {
		resetRowGroups();
		resetThinking();
		resetThinkingVisibility();
		resetThoughts();
		resetNativeThoughts();
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
