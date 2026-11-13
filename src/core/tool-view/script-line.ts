const LINE_BREAK_PATTERN = /\r?\n/;
const WHITESPACE_PATTERN = /\s+/g;
const SPACE = " ";
const SCRIPT_LINE_LENGTH = 60;
const ELLIPSIS = "…";
const BLANK = "";

export function scriptLine(code: string | undefined): string {
	if (!code) {
		return BLANK;
	}

	const firstLine = code.split(LINE_BREAK_PATTERN).find((line) => line.trim().length > 0) ?? BLANK;
	const oneLine = firstLine.replace(WHITESPACE_PATTERN, SPACE).trim();

	if (!oneLine) {
		return BLANK;
	}

	return oneLine.length > SCRIPT_LINE_LENGTH
		? `${oneLine.slice(0, SCRIPT_LINE_LENGTH - 1)}${ELLIPSIS}`
		: oneLine;
}
