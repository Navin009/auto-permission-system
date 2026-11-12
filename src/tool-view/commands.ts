import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { TOOL_VIEW_SETTINGS_FILE_NAME, writeToolViewMode } from "../core/tool-view/settings.ts";
import { ViewMode, viewModeLabel } from "../core/tool-view/view-mode.ts";
import { closeRowGroup, resetRowGroups } from "./row-groups.ts";
import { getActiveViewMode, setActiveViewMode } from "./session.ts";
import { applyThinkingLabel } from "./thinking-clock.ts";

export const TOOL_VIEW_COMMAND_NAME = "tool-view";

const SELECTION_TIMEOUT_MILLISECONDS = 120_000;
const MENU_TITLE = "Tool view:";
const ACTIVE_SUFFIX = "  (active)";

interface MenuChoice {
	option: string;
	mode: ViewMode;
}

const MENU_CHOICES: readonly MenuChoice[] = [
	{ option: "Compact — tool calls in rows", mode: ViewMode.Compact },
	{ option: "Full — Pi's own output", mode: ViewMode.Full },
];

const VIEW_MODES: readonly string[] = Object.values(ViewMode);
const SETTINGS_FILE_NOTE = `Set "view" in ${TOOL_VIEW_SETTINGS_FILE_NAME} instead.`;
const TUI_ONLY_NOTICE = `Tool view: the switch is TUI-only. ${SETTINGS_FILE_NOTE}`;
const USAGE_NOTICE = "Usage: /tool-view compact | full — or run /tool-view for the menu.";

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
	const options = MENU_CHOICES.map((choice) =>
		choice.mode === currentMode ? `${choice.option}${ACTIVE_SUFFIX}` : choice.option,
	);
	const selectionOptions = { timeout: SELECTION_TIMEOUT_MILLISECONDS };
	const pickedOption = await context.ui.select(MENU_TITLE, options, selectionOptions);

	if (pickedOption === undefined) {
		return undefined;
	}

	const pickedIndex = options.indexOf(pickedOption);

	return pickedIndex >= 0 ? MENU_CHOICES[pickedIndex].mode : undefined;
}

function applyViewMode(
	settingsFilePath: string,
	viewMode: ViewMode,
	context: ExtensionCommandContext,
): void {
	const writeError = writeToolViewMode(settingsFilePath, viewMode);
	setActiveViewMode(viewMode);
	closeGroupsFor(viewMode);
	applyThinkingLabel(context);

	if (writeError) {
		const modeLabel = viewModeLabel(viewMode);
		const savedForNow = `Tool view: ${modeLabel} for now — could not save it (${writeError}).`;

		context.ui.notify(savedForNow, "warning");
		return;
	}

	context.ui.notify(`Tool view: ${viewModeLabel(viewMode)}.`, "info");
}

function closeGroupsFor(viewMode: ViewMode): void {
	if (viewMode === ViewMode.Compact) {
		closeRowGroup();
		return;
	}

	resetRowGroups();
}
