import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { menuOptionLine, SELECTION_TIMEOUT_MILLISECONDS } from "../core/selection-menu.ts";
import { TOOL_VIEW_SETTINGS_FILE_NAME, writeToolViewMode } from "../core/tool-view/settings.ts";
import { ViewMode, viewModeLabel } from "../core/tool-view/view-mode.ts";
import { closeRowGroup, resetRowGroups } from "./row-groups.ts";
import { getActiveViewMode, setActiveViewMode } from "./session.ts";

export const TOOL_VIEW_COMMAND_NAME = "tool-view";

const MENU_TITLE = "Select tool view:";
const VIEW_MODES: readonly string[] = Object.values(ViewMode);
const SETTINGS_FILE_NOTE = `Set "view" in ${TOOL_VIEW_SETTINGS_FILE_NAME} instead.`;
const TUI_ONLY_NOTICE = `Tool view: the switch is TUI-only. ${SETTINGS_FILE_NOTE}`;
const USAGE_NOTICE = "Usage: /tool-view compact | full — or run /tool-view for the menu.";

interface ViewDefinition {
	mode: ViewMode;
	icon: string;
	name: string;
	description: string;
	notice: string;
}

const VIEW_DEFINITIONS: readonly ViewDefinition[] = [
	{
		mode: ViewMode.Compact,
		icon: "📦",
		name: "Compact",
		description: "Consecutive shell commands and reads drawn as rows",
		notice: "📦  Compact on. Consecutive shell commands and reads are drawn as rows.",
	},
	{
		mode: ViewMode.Full,
		icon: "🖥️",
		name: "Full",
		description: "Pi's own tool output, block for block",
		notice: "🖥️  Full. Pi's own tool output is back.",
	},
];

export async function runToolViewCommand(
	argument: string,
	settingsFilePath: string,
	context: ExtensionCommandContext,
): Promise<void> {
	if (context.mode !== "tui") {
		context.ui.notify(TUI_ONLY_NOTICE, "info");
		return;
	}

	const chosenMode = argument.trim() ? modeFromArgument(argument, context) : await pickMode(context);

	if (!chosenMode) {
		return;
	}

	applyViewMode(settingsFilePath, chosenMode, context);
}

function modeFromArgument(
	argument: string,
	context: ExtensionCommandContext,
): ViewMode | undefined {
	const requestedMode = argument.trim().toLowerCase();
	const matchedMode = VIEW_MODES.find((viewMode) => viewMode === requestedMode);

	if (!matchedMode) {
		context.ui.notify(USAGE_NOTICE, "warning");
	}

	return matchedMode as ViewMode | undefined;
}

async function pickMode(context: ExtensionCommandContext): Promise<ViewMode | undefined> {
	const currentMode = getActiveViewMode();
	const options = VIEW_DEFINITIONS.map((definition) =>
		menuOptionLine(definition, definition.mode === currentMode),
	);
	const selectionOptions = { timeout: SELECTION_TIMEOUT_MILLISECONDS };
	const pickedOption = await context.ui.select(MENU_TITLE, options, selectionOptions);

	if (pickedOption === undefined) {
		return undefined;
	}

	const pickedIndex = options.indexOf(pickedOption);

	return pickedIndex >= 0 ? VIEW_DEFINITIONS[pickedIndex].mode : undefined;
}

function applyViewMode(
	settingsFilePath: string,
	viewMode: ViewMode,
	context: ExtensionCommandContext,
): void {
	if (viewMode === getActiveViewMode()) {
		context.ui.notify(`Tool view is already ${viewModeLabel(viewMode)}.`, "info");
		return;
	}

	const writeError = writeToolViewMode(settingsFilePath, viewMode);
	setActiveViewMode(viewMode);
	closeGroupsFor(viewMode);

	if (writeError) {
		const modeLabel = viewModeLabel(viewMode);
		const savedForNow = `Tool view: ${modeLabel} for now — could not save it (${writeError}).`;

		context.ui.notify(savedForNow, "warning");
		return;
	}

	context.ui.notify(noticeFor(viewMode), "info");
}

function noticeFor(viewMode: ViewMode): string {
	const definition = VIEW_DEFINITIONS.find((candidate) => candidate.mode === viewMode);

	return definition ? definition.notice : `Tool view: ${viewModeLabel(viewMode)}.`;
}

function closeGroupsFor(viewMode: ViewMode): void {
	if (viewMode === ViewMode.Compact) {
		closeRowGroup();
		return;
	}

	resetRowGroups();
}
