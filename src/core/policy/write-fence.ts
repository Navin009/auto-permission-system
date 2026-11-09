import { commandHead, commandSegments, shellTokens } from "./shell-command.ts";
import { somePatternMatches } from "./patterns.ts";
import { looksLikePath, resolveTokenPaths, type PathCandidateOptions } from "./path-tokens.ts";
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

const IN_PLACE_EDITORS = new Set(["sed", "perl"]);
const IN_PLACE_FLAG = /^(?:-i|--in-place)/;
const REDIRECT_PATTERN = /^(?:\d*)(?:>>?|<)(.+)$/;
const REDIRECT_OPERATOR_PATTERN = /^(?:\d*)(?:>>?|<)$/;
const DATA_DESTINATION_PATTERN = /^of=(.+)$/;

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
