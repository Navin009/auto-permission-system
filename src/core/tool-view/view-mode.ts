export const ViewMode = {
	Compact: "compact",
	Full: "full",
} as const;
export type ViewMode = (typeof ViewMode)[keyof typeof ViewMode];

export const DEFAULT_VIEW_MODE: ViewMode = ViewMode.Full;

export function normalizeViewMode(value: unknown): ViewMode {
	return value === ViewMode.Compact ? ViewMode.Compact : DEFAULT_VIEW_MODE;
}

export function viewModeLabel(mode: ViewMode): string {
	return mode === ViewMode.Compact ? "Compact" : "Full";
}
