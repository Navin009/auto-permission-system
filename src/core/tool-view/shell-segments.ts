export const PAIR_CHAIN_OPERATORS: readonly string[] = ["&&", "||"];
export const SINGLE_CHAIN_OPERATORS: readonly string[] = ["|", ";"];
export const SEPARATOR_TOKENS: readonly string[] = [...PAIR_CHAIN_OPERATORS, ...SINGLE_CHAIN_OPERATORS];

const QUOTE_CHARACTERS: readonly string[] = ["'", '"'];
const ESCAPE_CHARACTER = "\\";
const SPACE = " ";

export interface ShellSegment {
	text: string;
	isOperator: boolean;
}

export function splitShellOperatorSegments(text: string): ShellSegment[] {
	const segments: ShellSegment[] = [];
	let currentStart = 0;
	let openQuote = "";
	let index = 0;

	while (index < text.length) {
		const character = text[index];

		if (openQuote) {
			if (character === ESCAPE_CHARACTER) {
				index += 2;
				continue;
			}

			if (character === openQuote) {
				openQuote = "";
			}

			index += 1;
			continue;
		}

		if (QUOTE_CHARACTERS.includes(character)) {
			openQuote = character;
			index += 1;
			continue;
		}

		const operatorLength = chainOperatorLengthAt(text, index);

		if (operatorLength === 0) {
			index += 1;
			continue;
		}

		if (index > currentStart) {
			segments.push({ text: text.slice(currentStart, index), isOperator: false });
		}

		segments.push({ text: text.slice(index, index + operatorLength), isOperator: true });
		index += operatorLength;
		currentStart = index;
	}

	if (currentStart < text.length) {
		segments.push({ text: text.slice(currentStart), isOperator: false });
	}

	return segments;
}

export function lastShellSegment(command: string): string {
	const segments = splitShellOperatorSegments(command);

	if (segments.length === 0) {
		return "";
	}

	const last = segments[segments.length - 1];

	return last.isOperator ? "" : last.text;
}

export function tokenizeShellCommand(text: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let openQuote = "";
	let index = 0;

	while (index < text.length) {
		const character = text[index];

		if (openQuote) {
			current += character;

			if (character === ESCAPE_CHARACTER) {
				current += text[index + 1] ?? "";
				index += 2;
				continue;
			}

			if (character === openQuote) {
				openQuote = "";
			}

			index += 1;
			continue;
		}

		if (QUOTE_CHARACTERS.includes(character)) {
			openQuote = character;
			current += character;
			index += 1;
			continue;
		}

		if (character === SPACE) {
			if (current) {
				tokens.push(current);
				current = "";
			}

			index += 1;
			continue;
		}

		current += character;
		index += 1;
	}

	if (current) {
		tokens.push(current);
	}

	return tokens;
}

function chainOperatorLengthAt(text: string, index: number): number {
	const pair = text.slice(index, index + 2);

	if (PAIR_CHAIN_OPERATORS.includes(pair)) {
		return pair.length;
	}

	return SINGLE_CHAIN_OPERATORS.includes(text[index]) ? 1 : 0;
}
