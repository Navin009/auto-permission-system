export const ExpansionLevel = {
	Row: 0,
	Group: 1,
	Collapsed: 2,
	Full: 3,
} as const;
export type ExpansionLevel = (typeof ExpansionLevel)[keyof typeof ExpansionLevel];

export function nextExpansionLevel(level: ExpansionLevel, hasGroupStep: boolean): ExpansionLevel {
	if (level === ExpansionLevel.Group) {
		return ExpansionLevel.Collapsed;
	}

	if (level === ExpansionLevel.Collapsed) {
		return ExpansionLevel.Full;
	}

	if (level === ExpansionLevel.Full) {
		return ExpansionLevel.Row;
	}

	return hasGroupStep ? ExpansionLevel.Group : ExpansionLevel.Collapsed;
}

export function resolvedExpansionLevel(level: ExpansionLevel, expandKeyHeld: boolean): ExpansionLevel {
	return expandKeyHeld ? ExpansionLevel.Full : level;
}
