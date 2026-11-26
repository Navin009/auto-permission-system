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

function displayWidth(text: string): number {
	let width = 0;

	for (const character of text) {
		const codePoint = character.codePointAt(0) ?? 0;

		if (codePoint >= 0x1f300) {
			width += 2;
		} else {
			width += 1;
		}
	}

	return width;
}

export function menuOptionLine(entry: MenuEntry, isActive: boolean): string {
	const label = isActive ? `${entry.name}${ACTIVE_SUFFIX}` : entry.name;
	const padding = Math.max(0, MENU_LABEL_COLUMN_WIDTH - displayWidth(label));
	const labelColumn = `${label}${" ".repeat(padding)}`;

	return `${entry.icon}${ICON_GAP}${labelColumn}${DESCRIPTION_SEPARATOR}${entry.description}`;
}
