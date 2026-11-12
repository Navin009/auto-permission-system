const PAIR_SEPARATORS: readonly string[] = ["&&", "||"];
const SINGLE_SEPARATORS: readonly string[] = [";", "|"];
const SEPARATOR_TOKENS: readonly string[] = [...PAIR_SEPARATORS, ...SINGLE_SEPARATORS];
const CD_COMMAND = "cd";
const QUOTE_CHARACTERS: readonly string[] = ["'", '"'];
const ESCAPE_CHARACTER = "\\";
const SPACE = " ";
const WHITESPACE_PATTERN = /\s+/g;
const PATH_SEPARATOR = "/";
const ELLIPSIS = "…";
const MINIMUM_TAIL_LENGTH = 1;
const SINGLE_TOKEN = 1;

const PREFIX_WORDS: readonly string[] = ["sudo", "time", "command", "exec", "nohup", "env", "npx"];
const PREFIX_PAIRS: readonly (readonly [string, string])[] = [
	["uv", "run"],
	["poetry", "run"],
	["pipenv", "run"],
	["pnpm", "exec"],
	["pnpm", "dlx"],
	["yarn", "dlx"],
	["bundle", "exec"],
];
const ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PYTHON_PATTERN = /^(python[0-9.]*|py)$/;
const PYTHON_SCRIPT_SUFFIX = ".py";
const MODULE_FLAG = "-m";
const CODE_FLAG = "-c";
const STDIN_FLAG = "-";
const STDIN_LABEL = "(stdin)";

export function summarizeShellCommand(command: string): string {
	const oneLine = collapseWhitespace(command);
	const segment = collapseWhitespace(lastSegment(command));

	return hoistProgram(tokenize(segment || oneLine), inlineScriptLine(command)).join(SPACE);
}

export function displayShellCommand(command: string): string {
	const tokens = tokenize(collapseWhitespace(command));

	return hoistProgram(withoutLeadingCd(tokens), inlineScriptLine(command)).join(SPACE);
}

export function fitCommand(command: string, budget: number): string {
	if (command.length <= budget) {
		return command;
	}

	const tokens = tokenize(command);

	if (tokens.length <= SINGLE_TOKEN) {
		return fitTarget(command, budget) ?? ELLIPSIS;
	}

	const tail = tokens[tokens.length - 1];

	for (let headLength = tokens.length - 1; headLength >= 1; headLength -= 1) {
		const candidate = `${tokens.slice(0, headLength).join(SPACE)}${SPACE}${ELLIPSIS}${SPACE}${tail}`;

		if (candidate.length <= budget) {
			return candidate;
		}
	}

	const tailFit = tailWithin(tail, budget - ELLIPSIS.length - SPACE.length);

	if (tailFit) {
		return `${ELLIPSIS}${SPACE}${tailFit}`;
	}

	const program = tokens[0];

	if (`${program}${SPACE}${ELLIPSIS}`.length <= budget) {
		return `${program}${SPACE}${ELLIPSIS}`;
	}

	return fitTarget(program, budget) ?? ELLIPSIS;
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

function collapseWhitespace(text: string): string {
	return text.replace(WHITESPACE_PATTERN, SPACE).trim();
}

function withoutLeadingCd(tokens: readonly string[]): string[] {
	if (tokens[0] !== CD_COMMAND) {
		return [...tokens];
	}

	const separatorIndex = tokens.findIndex((token) => SEPARATOR_TOKENS.includes(token));

	return separatorIndex >= 0 ? tokens.slice(separatorIndex + 1) : [...tokens];
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

	if (PAIR_SEPARATORS.includes(pair)) {
		return pair.length;
	}

	return SINGLE_SEPARATORS.includes(command[index]) ? 1 : 0;
}

function tokenize(text: string): string[] {
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

function hoistProgram(tokens: readonly string[], scriptLine: string | undefined): string[] {
	return hoistInterpreter(dropPrefixes(tokens), scriptLine);
}

function dropPrefixes(tokens: readonly string[]): string[] {
	let index = 0;

	while (index < tokens.length) {
		const word = tokens[index];

		if (PREFIX_WORDS.includes(word) || ASSIGNMENT_PATTERN.test(word)) {
			index += 1;
			continue;
		}

		if (PREFIX_PAIRS.some(([first, second]) => word === first && tokens[index + 1] === second)) {
			index += 2;
			continue;
		}

		break;
	}

	return tokens.slice(index);
}

function hoistInterpreter(tokens: readonly string[], scriptLine: string | undefined): string[] {
	const program = tokens[0];

	if (!program || !isPython(program)) {
		return [...tokens];
	}

	const moduleIndex = tokens.indexOf(MODULE_FLAG, 1);

	if (moduleIndex > 0 && tokens[moduleIndex + 1]) {
		return [tokens[moduleIndex + 1], ...tokens.slice(moduleIndex + 2)];
	}

	const codeIndex = tokens.indexOf(CODE_FLAG, 1);

	if (codeIndex > 0) {
		return scriptLine ? [program, scriptLine] : [program, CODE_FLAG, ELLIPSIS];
	}

	const stdinIndex = tokens.indexOf(STDIN_FLAG, 1);

	if (stdinIndex > 0) {
		return scriptLine ? [program, scriptLine] : [program, STDIN_LABEL];
	}

	const scriptIndex = tokens.findIndex((token, index) => index > 0 && token.endsWith(PYTHON_SCRIPT_SUFFIX));

	if (scriptIndex > 0) {
		return [tokens[scriptIndex], ...tokens.slice(scriptIndex + 1)];
	}

	return [...tokens];
}

function isPython(program: string): boolean {
	const name = program.split(PATH_SEPARATOR).at(-1) ?? program;

	return PYTHON_PATTERN.test(name);
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

const HEREDOC_PATTERN = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n([\s\S]*?)\n\s*\2\b/;
const INLINE_CODE_PATTERN = /(?:^|\s)(?:-c|-e)\s+(?:'([\s\S]*?)'|"((?:[^"\\]|\\.)*)")/;
const LINE_BREAK_PATTERN = /\r?\n/;
const SCRIPT_LINE_LIMIT = 40;
const HINT_LENGTH_LIMIT = 24;
const URL_PATTERN = /^https?:\/\//;
const FLAG_PREFIX = "-";
const NAME_SEPARATOR = " ";

export function programHint(command: string): string {
	const tokens = tokenize(displayShellCommand(command));
	const segments = splitSegments(tokens);
	const program = pathName(segments[0]?.[0] ?? "");

	if (!program) {
		return "";
	}

	if (inlineScriptLine(command)) {
		return program;
	}

	const ownSegments = segments.filter((segment) => pathName(segment[0] ?? "") === program);
	const hint = hintToken(ownSegments.at(-1) ?? tokens.slice(1));

	return hint ? `${program}${NAME_SEPARATOR}${hint}` : program;
}

function splitSegments(tokens: readonly string[]): string[][] {
	const segments: string[][] = [[]];

	for (const token of tokens) {
		if (SEPARATOR_TOKENS.includes(token)) {
			segments.push([]);
			continue;
		}

		segments[segments.length - 1].push(token);
	}

	return segments.filter((segment) => segment.length > 0);
}

function hintToken(segment: readonly string[]): string {
	const candidates = segment
		.slice(1)
		.filter((token) => !token.startsWith(FLAG_PREFIX))
		.filter((token) => !QUOTE_CHARACTERS.includes(token[0] ?? ""));
	const chosen = candidates.at(-1);

	return chosen ? shortenHint(normalizeHint(chosen)) : "";
}

function normalizeHint(token: string): string {
	if (URL_PATTERN.test(token)) {
		try {
			return new URL(token).host;
		} catch {
			return token;
		}
	}

	return token;
}

function shortenHint(hint: string): string {
	return hint.length > HINT_LENGTH_LIMIT ? `${hint.slice(0, HINT_LENGTH_LIMIT - 1)}${ELLIPSIS}` : hint;
}

function inlineScriptLine(command: string): string | undefined {
	const heredoc = HEREDOC_PATTERN.exec(command);
	const inline = INLINE_CODE_PATTERN.exec(command);
	const script = heredoc?.[3] ?? inline?.[1] ?? inline?.[2];

	if (!script) {
		return undefined;
	}

	const firstLine = script.split(LINE_BREAK_PATTERN).find((line) => line.trim().length > 0);
	const oneLine = firstLine?.replace(WHITESPACE_PATTERN, SPACE).trim();

	if (!oneLine) {
		return undefined;
	}

	return oneLine.length > SCRIPT_LINE_LIMIT ? `${oneLine.slice(0, SCRIPT_LINE_LIMIT - 1)}${ELLIPSIS}` : oneLine;
}

function pathName(token: string): string {
	return token.split(PATH_SEPARATOR).at(-1) ?? token;
}
