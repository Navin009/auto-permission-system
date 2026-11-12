import { ViewMode } from "./view-mode.ts";

const COMPACT_THINKING_LABEL = "~ Thought — click to read";

export function hiddenThinkingLabel(viewMode: ViewMode): string | undefined {
	return viewMode === ViewMode.Compact ? COMPACT_THINKING_LABEL : undefined;
}
