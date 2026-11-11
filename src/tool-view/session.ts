import { DEFAULT_VIEW_MODE, type ViewMode } from "../core/tool-view/view-mode.ts";

let activeViewMode: ViewMode = DEFAULT_VIEW_MODE;

export function setActiveViewMode(viewMode: ViewMode): void {
	activeViewMode = viewMode;
}

export function getActiveViewMode(): ViewMode {
	return activeViewMode;
}
