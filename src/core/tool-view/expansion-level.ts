export const ExpansionLevel = {
	Row: 0,
	Collapsed: 1,
	Full: 2,
} as const;
export type ExpansionLevel = (typeof ExpansionLevel)[keyof typeof ExpansionLevel];

export function nextExpansionLevel(level: ExpansionLevel): ExpansionLevel {
	if (level === ExpansionLevel.Row) {
		return ExpansionLevel.Collapsed;
	}

	if (level === ExpansionLevel.Collapsed) {
		return ExpansionLevel.Full;
	}

	return ExpansionLevel.Row;
}

export function resolvedExpansionLevel(level: ExpansionLevel, expandKeyHeld: boolean): ExpansionLevel {
	return expandKeyHeld ? ExpansionLevel.Full : level;
}
