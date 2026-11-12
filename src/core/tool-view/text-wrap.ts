const LINE_BREAK = "\n";
const WHITESPACE_PATTERN = /\s+/;
const SPACE = " ";
const BLANK = "";

export function wrapText(text: string, width: number): string[] {
	const limit = Math.max(1, Math.floor(width));

	return text.split(LINE_BREAK).flatMap((line) => wrapLine(line, limit));
}

function wrapLine(line: string, width: number): string[] {
	const lines: string[] = [];
	let current = BLANK;

	for (const word of line.split(WHITESPACE_PATTERN)) {
		if (word === BLANK) {
			continue;
		}

		for (const piece of splitWord(word, width)) {
			const candidate = current === BLANK ? piece : `${current}${SPACE}${piece}`;

			if (candidate.length <= width) {
				current = candidate;
				continue;
			}

			lines.push(current);
			current = piece;
		}
	}

	if (current !== BLANK) {
		lines.push(current);
	}

	return lines;
}

function splitWord(word: string, width: number): string[] {
	if (word.length <= width) {
		return [word];
	}

	const pieces: string[] = [];

	for (let start = 0; start < word.length; start += width) {
		pieces.push(word.slice(start, start + width));
	}

	return pieces;
}
