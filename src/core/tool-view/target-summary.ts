const SEGMENT_SEPARATORS: readonly string[] = ["&&", "||", ";", "|", "\n"];
const QUOTE_CHARACTERS: readonly string[] = ["'", '"'];
const ESCAPE_CHARACTER = "\\";
const SPACE = " ";
const WHITESPACE_PATTERN = /\s+/g;
const PATH_SEPARATOR = "/";
const ELLIPSIS = "…";
const MINIMUM_TAIL_LENGTH = 1;

export function summarizeShellCommand(command: string): string {
	const segment = lastSegment(command).replace(WHITESPACE_PATTERN, SPACE).trim();

	return segment || command.replace(WHITESPACE_PATTERN, SPACE).trim();
}

export function fitTarget(label: string, budget: number): string | undefined {
	if (label.length <= budget) {
		return label;
	}

	const tailBudget = budget - ELLIPSIS.length - SPACE.length;

	if (tailBudget < MINIMUM_TAIL_LENGTH) {
		return undefined;
	}

	const tail = tailWithin(label, tailBudget);

	return tail ? `${ELLIPSIS}${SPACE}${tail}` : undefined;
}

function lastSegment(command: string): string {
	let segmentStart = 0;
	let openQuote = "";
	let index = 0;

	while (index < command.length) {
		const character = command[index];

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

		const separatorLength = separatorLengthAt(command, index);

		if (separatorLength === 0) {
			index += 1;
			continue;
		}

		index += separatorLength;
		segmentStart = index;
	}

	return command.slice(segmentStart);
}

function separatorLengthAt(command: string, index: number): number {
	const pair = command.slice(index, index + 2);

	if (pair === "&&" || pair === "||") {
		return pair.length;
	}

	return SEGMENT_SEPARATORS.includes(command[index]) ? 1 : 0;
}

function tailWithin(label: string, tailBudget: number): string | undefined {
	const tokens = label.split(SPACE);
	const tail = tokenTail(tokens, tailBudget);

	return tail ?? pathTail(tokens.at(-1) ?? "", tailBudget);
}

function tokenTail(tokens: readonly string[], tailBudget: number): string | undefined {
	let tail = tokens.at(-1) ?? "";

	if (tail.length > tailBudget) {
		return undefined;
	}

	for (let index = tokens.length - 2; index >= 0; index -= 1) {
		const candidate = `${tokens[index]}${SPACE}${tail}`;

		if (candidate.length > tailBudget) {
			break;
		}

		tail = candidate;
	}

	return tail;
}

function pathTail(path: string, tailBudget: number): string | undefined {
	if (!path.includes(PATH_SEPARATOR)) {
		return undefined;
	}

	const segments = path.split(PATH_SEPARATOR).filter(Boolean);
	let tail = segments.at(-1) ?? "";

	if (!tail || tail.length > tailBudget) {
		return undefined;
	}

	for (let index = segments.length - 2; index >= 0; index -= 1) {
		const candidate = `${segments[index]}${PATH_SEPARATOR}${tail}`;

		if (candidate.length > tailBudget) {
			break;
		}

		tail = candidate;
	}

	return tail;
}
