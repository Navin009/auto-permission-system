const SEGMENT_SEPARATOR = /\s*(?:;|&&|\|\||\||\n|(?<![><&])&(?!&))\s*/;
const TOKEN_PATTERN = /"([^"]*)"|'([^']*)'|(\S+)/g;
const HEREDOC_TAIL_PATTERN = /^-?\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_][A-Za-z0-9_-]*))/;
const QUOTE_CHARACTERS = new Set(['"', "'"]);
const SINGLE_QUOTE = "'";
const ESCAPE_CHARACTER = "\\";
const SEMICOLON = ";";
const PIPE = "|";
const AMPERSAND = "&";
const AMPERSAND_PRECEDERS = new Set([">", "<", "&"]);
const SUBSTITUTION_PATTERN = /\$\(([^()]*)\)|`([^`]*)`/g;
const WRAPPING_PARENTHESES_START = /^\(+/;
const WRAPPING_PARENTHESES_END = /\)+$/;
const SUBSTITUTION_MARKERS = ["$(", "`"];
const ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WRAPPER_POSITIONAL_PATTERN = /^\d+(?:\.\d+)?[smhd]?$/;

const MAXIMUM_NESTING_DEPTH = 3;

const SHELL_COMMANDS = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash", "fish", "busybox"]);
const COMMAND_STRING_FLAGS = new Set(["-c", "-lc", "-ic", "-xc", "--command", "-Command"]);
const COMMAND_WRAPPERS = new Set([
	"sudo",
	"doas",
	"env",
	"nice",
	"nohup",
	"time",
	"timeout",
	"stdbuf",
	"command",
	"builtin",
	"exec",
	"setsid",
	"strace",
	"xargs",
	"parallel",
	"unbuffer",
]);
const WRAPPER_FLAGS_WITH_VALUE = new Set([
	"-u",
	"-g",
	"-n",
	"-o",
	"-e",
	"-s",
	"-p",
	"-t",
	"--user",
	"--group",
	"--signal",
	"--kill-after",
	"--chdir",
]);

export function binaryName(token: string): string {
	return token.split("/").pop() ?? token;
}

export function isShellCommand(binary: string): boolean {
	return SHELL_COMMANDS.has(binary);
}

function heredocDelimiters(line: string): string[] {
	const delimiters: string[] = [];
	let openQuote: string | undefined;
	let position = 0;

	while (position < line.length) {
		const character = line[position];

		if (openQuote) {
			if (character === openQuote) openQuote = undefined;
			position++;
			continue;
		}

		if (QUOTE_CHARACTERS.has(character)) {
			openQuote = character;
			position++;
			continue;
		}

		if (character !== "<" || line[position + 1] !== "<" || line[position - 1] === "<" || line[position + 2] === "<") {
			position++;
			continue;
		}

		const match = HEREDOC_TAIL_PATTERN.exec(line.slice(position + 2));

		if (!match) {
			position++;
			continue;
		}

		delimiters.push(match[1] ?? match[2] ?? match[3]);
		position += 2 + match[0].length;
	}

	return delimiters;
}

/** Length of the separator that starts at `position`, or 0 when none starts there. */
function separatorLength(line: string, position: number): number {
	const character = line[position];

	if (character === SEMICOLON) return 1;

	if (character === PIPE) return line[position + 1] === PIPE ? 2 : 1;

	if (character !== AMPERSAND) return 0;

	if (line[position + 1] === AMPERSAND) return 2;

	return AMPERSAND_PRECEDERS.has(line[position - 1]) ? 0 : 1;
}

/**
 * Split one command line on the separators that are not inside quotes.
 *
 * A quoted search pattern is data, not structure: `grep -rnE "a|b" docs` runs
 * one command, yet splitting on the `|` inside the quotes fabricated a second
 * one whose leftover operand (`.*`) resolved to the working directory and asked
 * to read its `.env` (ADR-050). A line that ends with an open quote keeps the
 * plain separator split, so unusual input stays fail-closed.
 */
function splitSegments(line: string, separator: RegExp): string[] {
	const segments: string[] = [];
	let openQuote: string | undefined;
	let segmentStart = 0;
	let position = 0;

	while (position < line.length) {
		const character = line[position];

		if (character === ESCAPE_CHARACTER && openQuote !== SINGLE_QUOTE) {
			position += 2;
			continue;
		}

		if (openQuote) {
			if (character === openQuote) openQuote = undefined;
			position++;
			continue;
		}

		if (QUOTE_CHARACTERS.has(character)) {
			openQuote = character;
			position++;
			continue;
		}

		const length = separatorLength(line, position);

		if (!length) {
			position++;
			continue;
		}

		segments.push(line.slice(segmentStart, position));
		position += length;
		segmentStart = position;
	}

	if (openQuote) return line.split(separator);

	segments.push(line.slice(segmentStart));

	return segments;
}

export function shellSegments(command: string): string[] {
	const segments: string[] = [];
	const openDelimiters: string[] = [];

	for (const line of command.split("\n")) {
		const openDelimiter = openDelimiters[0];

		if (openDelimiter !== undefined) {
			if (line.trim() === openDelimiter) openDelimiters.shift();
			continue;
		}

		openDelimiters.push(...heredocDelimiters(line));

		for (const separatedSegment of splitSegments(line, SEGMENT_SEPARATOR)) {
			const segment = separatedSegment.trim();

			if (segment) segments.push(segment);
		}
	}

	return segments;
}

/** A backslash-escaped paren is an argument (`find . \\( -name a -o -name b \\)`), not a shell wrapper. */
const ESCAPED_PAREN_START = "\\";

function stripWrappingParentheses(token: string): string {
	if (token.startsWith(ESCAPED_PAREN_START)) return token;

	const withoutLeadingParens = token.replace(WRAPPING_PARENTHESES_START, "");

	if (SUBSTITUTION_MARKERS.some((marker) => withoutLeadingParens.includes(marker))) return withoutLeadingParens;

	return withoutLeadingParens.replace(WRAPPING_PARENTHESES_END, "");
}

export function shellTokens(segment: string): string[] {
	const tokens: string[] = [];

	for (const match of segment.matchAll(TOKEN_PATTERN)) {
		tokens.push(stripWrappingParentheses(match[1] ?? match[2] ?? match[3] ?? ""));
	}

	return tokens;
}

function afterWrapperArguments(tokens: readonly string[], startIndex: number): number {
	let cursor = startIndex;

	while (cursor < tokens.length) {
		const token = tokens[cursor];

		if (token === "--") return cursor + 1;
		if (ASSIGNMENT_PATTERN.test(token) || WRAPPER_POSITIONAL_PATTERN.test(token)) {
			cursor++;
			continue;
		}
		if (token.startsWith("-") && token !== "-") {
			cursor += WRAPPER_FLAGS_WITH_VALUE.has(token) ? 2 : 1;
			continue;
		}
		break;
	}

	return cursor;
}

function commandStartIndex(tokens: readonly string[]): number {
	let index = 0;

	while (index < tokens.length) {
		const token = tokens[index];

		if (ASSIGNMENT_PATTERN.test(token)) {
			index++;
			continue;
		}

		if (COMMAND_WRAPPERS.has(binaryName(token))) {
			const nextIndex = afterWrapperArguments(tokens, index + 1);

			if (nextIndex >= tokens.length) return index;

			index = nextIndex;
			continue;
		}

		break;
	}

	return index;
}

export function commandHead(tokens: readonly string[]): { head: string; headIndex: number } {
	const headIndex = commandStartIndex(tokens);

	return { head: binaryName(tokens[headIndex] ?? ""), headIndex };
}

const COMMAND_STRING_COMMANDS = new Set(["eval"]);

function nestedCommands(segment: string): string[] {
	const nested: string[] = [];
	const tokens = shellTokens(segment);
	const { head, headIndex } = commandHead(tokens);

	if (isShellCommand(head)) {
		const flagIndex = tokens.findIndex((token, index) => index > headIndex && COMMAND_STRING_FLAGS.has(token));
		const innerCommand = flagIndex >= 0 ? tokens[flagIndex + 1] : undefined;

		if (innerCommand) nested.push(innerCommand);
	}

	if (COMMAND_STRING_COMMANDS.has(head)) {
		const innerCommand = tokens.slice(headIndex + 1).join(" ").trim();

		if (innerCommand) nested.push(innerCommand);
	}

	for (const match of segment.matchAll(SUBSTITUTION_PATTERN)) {
		const innerCommand = match[1] ?? match[2];

		if (innerCommand) nested.push(innerCommand);
	}

	return nested;
}

export function commandSegments(command: string, depth = 0): string[] {
	if (depth > MAXIMUM_NESTING_DEPTH) return [];

	const segments: string[] = [];

	for (const segment of shellSegments(command)) {
		segments.push(segment);

		for (const innerCommand of nestedCommands(segment)) {
			segments.push(...commandSegments(innerCommand, depth + 1));
		}
	}

	return segments;
}
