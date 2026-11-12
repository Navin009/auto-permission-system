import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { ViewMode } from "../core/tool-view/view-mode.ts";

const HIDDEN_LABEL_IN_COMPACT = "";
const RESTORED_LABEL = undefined;

let appliedLabel: string | undefined;
let hasApplied = false;
let thoughtsRendered = false;

export function noteThinkingRendered(): void {
	thoughtsRendered = true;
}

export function thoughtsRenderAsBlocks(): boolean {
	return thoughtsRendered;
}

export function resetThinkingVisibility(): void {
	thoughtsRendered = false;
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
