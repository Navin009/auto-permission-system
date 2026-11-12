import { hiddenThinkingLabel } from "../core/tool-view/thinking.ts";
import { getActiveViewMode } from "./session.ts";

export interface ThinkingLabelHost {
	ui: { setHiddenThinkingLabel(label?: string): void };
}

export function applyThinkingLabel(host: ThinkingLabelHost): void {
	host.ui.setHiddenThinkingLabel?.(hiddenThinkingLabel(getActiveViewMode()));
}
