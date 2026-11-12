import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { ViewMode } from "../core/tool-view/view-mode.ts";

const HIDDEN_LABEL_IN_COMPACT = "";
const RESTORED_LABEL = undefined;

let appliedLabel: string | undefined;
let hasApplied = false;

export function resetThinkingVisibility(): void {
	appliedLabel = undefined;
	hasApplied = false;
}

export function applyThinkingVisibility(
	viewMode: ViewMode,
	ui: ExtensionUIContext | undefined,
): void {
	const label = viewMode === ViewMode.Compact ? HIDDEN_LABEL_IN_COMPACT : RESTORED_LABEL;

	if (!ui || (hasApplied && appliedLabel === label)) {
		return;
	}

	try {
		ui.setHiddenThinkingLabel(label);
		appliedLabel = label;
		hasApplied = true;
	} catch {
		hasApplied = false;
	}
}
