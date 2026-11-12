export const SELECTION_TIMEOUT_MILLISECONDS = 120_000;

const MENU_LABEL_COLUMN_WIDTH = 26;
const ACTIVE_SUFFIX = " (active)";
const ICON_GAP = "  ";
const DESCRIPTION_SEPARATOR = " —  ";

export interface MenuEntry {
	icon: string;
	name: string;
	description: string;
}

export function menuOptionLine(entry: MenuEntry, isActive: boolean): string {
	const label = isActive ? `${entry.name}${ACTIVE_SUFFIX}` : entry.name;
	const labelColumn = label.padEnd(MENU_LABEL_COLUMN_WIDTH);

	return `${entry.icon}${ICON_GAP}${labelColumn}${DESCRIPTION_SEPARATOR}${entry.description}`;
}
