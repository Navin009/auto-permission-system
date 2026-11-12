import { DEFAULT_VIEW_MODE, type ViewMode } from "../core/tool-view/view-mode.ts";

let activeViewMode: ViewMode = DEFAULT_VIEW_MODE;
let thoughtsVisibleLookup: (() => boolean) | undefined;

export function setActiveViewMode(viewMode: ViewMode): void {
	activeViewMode = viewMode;
}

export function getActiveViewMode(): ViewMode {
	return activeViewMode;
}

export function setThoughtsVisibleLookup(lookup: (() => boolean) | undefined): void {
	thoughtsVisibleLookup = lookup;
}

export function thoughtsVisibleInTranscript(): boolean {
	return thoughtsVisibleLookup?.() ?? false;
}
