import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { menuOptionLine, SELECTION_TIMEOUT_MILLISECONDS } from "../core/selection-menu.ts";
import { TOOL_VIEW_SETTINGS_FILE_NAME, writeToolViewMode } from "../core/tool-view/settings.ts";
import { ViewMode, viewModeLabel } from "../core/tool-view/view-mode.ts";
import { closeRowGroup, hasLiveRow, resetRowGroups } from "./row-groups.ts";
import { getActiveViewMode, setActiveViewMode } from "./session.ts";
import { applyThinkingLabel } from "./thinking-clock.ts";

export const TOOL_VIEW_COMMAND_NAME = "tool-view";

const MENU_TITLE = "Select tool view:";
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

	const chosenDefinition = argument.trim()
		? definitionFromArgument(argument, context)
		: await pickDefinition(context);

	if (!chosenDefinition) {
		return;
	}

	applyViewMode(settingsFilePath, chosenDefinition, context);
}

function definitionFromArgument(
	argument: string,
	context: ExtensionCommandContext,
): ViewDefinition | undefined {
	const requestedMode = argument.trim().toLowerCase();
	const matchedDefinition = VIEW_DEFINITIONS.find(
		(definition) => definition.mode === requestedMode,
	);

	if (!matchedDefinition) {
		context.ui.notify(USAGE_NOTICE, "warning");
	}

	return matchedDefinition;
}

async function pickDefinition(context: ExtensionCommandContext): Promise<ViewDefinition | undefined> {
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

	return pickedIndex >= 0 ? VIEW_DEFINITIONS[pickedIndex] : undefined;
}

function applyViewMode(
	settingsFilePath: string,
	definition: ViewDefinition,
	context: ExtensionCommandContext,
): void {
	const viewMode = definition.mode;

	if (viewMode === getActiveViewMode()) {
		context.ui.notify(`Tool view is already ${viewModeLabel(viewMode)}.`, "info");
		return;
	}

	const writeError = writeToolViewMode(settingsFilePath, viewMode);
	setActiveViewMode(viewMode);
	closeGroupsFor(viewMode);
	applyThinkingLabel(context, hasLiveRow());

	if (writeError) {
		const modeLabel = viewModeLabel(viewMode);
		const savedForNow = `Tool view: ${modeLabel} for now — could not save it (${writeError}).`;

		context.ui.notify(savedForNow, "warning");
		return;
	}

	context.ui.notify(definition.notice, "info");
}

function closeGroupsFor(viewMode: ViewMode): void {
	if (viewMode === ViewMode.Compact) {
		closeRowGroup();
		return;
	}

	resetRowGroups();
}
