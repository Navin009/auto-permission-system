import { commandHead, commandSegments, shellTokens } from "./shell-command.ts";
import { somePatternMatches } from "./patterns.ts";
import { embeddedPathTokens, looksLikePath, resolveTokenPaths, type PathCandidateOptions } from "./path-tokens.ts";
import type { FilesystemPolicy } from "./classify.ts";

const WRITE_COMMANDS = new Set([
	"touch",
	"truncate",
	"rm",
	"unlink",
	"shred",
	"mkdir",
	"rmdir",
	"chmod",
	"chown",
	"chgrp",
	"unzip",
	"tee",
]);

const COPY_COMMANDS = new Set(["cp", "mv", "install", "ln", "rsync", "scp"]);

/**
 * Heads that take the program as an inline argument. `node -e "…"` writes with
 * its own file API, so no redirect, known writer or in-place flag names the
 * target: the program text is the only evidence, and a write API next to a
 * protected path is what this rule reads (ADR-051).
 */
const INLINE_CODE_HEADS = new Set([
	"node",
	"nodejs",
	"deno",
	"bun",
	"python",
	"python2",
	"python3",
	"perl",
	"ruby",
	"php",
	"lua",
	"osascript",
	"powershell",
	"pwsh",
]);

const INLINE_CODE_FLAGS = new Set(["-e", "--eval", "-p", "--print", "-c", "-r", "eval", "-Command"]);

/** File-writing APIs. Reading one of these next to a path is what a reader is not. */
const WRITE_API_PATTERN =
	/\b(?:writeFile|appendFile|createWriteStream|writeSync|writelines|write_text|write_bytes|openSync|shutil\.|copyFile|renameSync|unlinkSync|rmSync|rmdirSync|mkdirSync|chmodSync|truncate)|\.write\(/;

const IN_PLACE_EDITORS = new Set(["sed", "perl"]);
const IN_PLACE_FLAG = /^(?:-i|--in-place)/;
const REDIRECT_PATTERN = /^(?:\d*)(?:>>?|<)(.+)$/;
const REDIRECT_OPERATOR_PATTERN = /^(?:\d*)(?:>>?|<)$/;
const DATA_DESTINATION_PATTERN = /^of=(.+)$/;

function isInlineCodeWrite(head: string, operands: readonly string[], segment: string): boolean {
	if (!INLINE_CODE_HEADS.has(head)) return false;
	if (!operands.some((operand) => INLINE_CODE_FLAGS.has(operand))) return false;

	return WRITE_API_PATTERN.test(segment);
}

function writePathCandidates(
	command: string,
	workingDirectory: string,
	homeDirectory: string,
	options: PathCandidateOptions,
): string[] {
	const foundPaths = new Set<string>();

	const addPaths = (token: string): void => {
		for (const absolutePath of resolveTokenPaths(token, workingDirectory, homeDirectory, options)) {
			foundPaths.add(absolutePath);
		}
	};

	for (const segment of commandSegments(command)) {
		const tokens = shellTokens(segment);
		const { head, headIndex } = commandHead(tokens);
		const operands = tokens.slice(headIndex + 1);
		const pathOperands = operands.filter(looksLikePath);

		for (let index = 0; index < operands.length; index++) {
			const token = operands[index];

			if (REDIRECT_OPERATOR_PATTERN.test(token)) {
				if (operands[index + 1]) addPaths(operands[index + 1]);
				index++;
				continue;
			}

			const redirectTarget = REDIRECT_PATTERN.exec(token)?.[1];
			if (redirectTarget) addPaths(redirectTarget);

			const dataDestination = DATA_DESTINATION_PATTERN.exec(token)?.[1];
			if (dataDestination) addPaths(dataDestination);
		}

		if (isInlineCodeWrite(head, operands, segment)) {
			for (const operand of operands) {
				for (const token of embeddedPathTokens(operand)) addPaths(token);
			}

			continue;
		}

		if (WRITE_COMMANDS.has(head)) {
			pathOperands.forEach(addPaths);
			continue;
		}

		if (IN_PLACE_EDITORS.has(head) && operands.some((token) => IN_PLACE_FLAG.test(token))) {
			pathOperands.forEach(addPaths);
			continue;
		}

		if (COPY_COMMANDS.has(head)) {
			const destination = pathOperands.pop();

			if (destination) addPaths(destination);
		}
	}

	return [...foundPaths];
}

export function deniedWriteCandidates(
	command: string,
	workingDirectory: string,
	homeDirectory: string,
	filesystem: FilesystemPolicy,
	resolvePath: (path: string) => string = (path) => path,
	options: PathCandidateOptions = {},
): string[] {
	const candidates = writePathCandidates(command, workingDirectory, homeDirectory, options).map(resolvePath);

	return [...new Set(candidates)].filter((candidatePath) =>
		somePatternMatches(candidatePath, filesystem.denyWrite, workingDirectory, homeDirectory),
	);
}

export function askWriteCandidates(
	command: string,
	workingDirectory: string,
	homeDirectory: string,
	filesystem: FilesystemPolicy,
	resolvePath: (path: string) => string = (path) => path,
	options: PathCandidateOptions = {},
): string[] {
	const askWritePatterns = filesystem.askWrite ?? [];

	if (!askWritePatterns.length) {
		return [];
	}

	const candidates = writePathCandidates(command, workingDirectory, homeDirectory, options).map(resolvePath);

	return [...new Set(candidates)].filter(
		(candidatePath) =>
			!somePatternMatches(candidatePath, filesystem.denyWrite, workingDirectory, homeDirectory) &&
			somePatternMatches(candidatePath, askWritePatterns, workingDirectory, homeDirectory),
	);
}
