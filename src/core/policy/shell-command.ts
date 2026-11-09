const SEGMENT_SEPARATOR = /\s*(?:;|&&|\|\||\||\n|(?<![><&])&(?!&))\s*/;
const TOKEN_PATTERN = /"([^"]*)"|'([^']*)'|(\S+)/g;
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

export function shellSegments(command: string): string[] {
	return command
		.split(SEGMENT_SEPARATOR)
		.map((segment) => segment.trim())
		.filter(Boolean);
}

function stripWrappingParentheses(token: string): string {
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
