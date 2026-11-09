import { existsSync } from "node:fs";
import { basename, dirname } from "node:path";
import { normalizeAbs, somePatternMatches, toSandboxPatterns } from "./patterns.ts";
import { commandHead, commandSegments, shellTokens } from "./shell-command.ts";
import {
	embeddedPathTokens,
	listDirectoryFiles,
	resolveTokenPaths,
	type PathCandidateOptions,
} from "./path-tokens.ts";
import { ReadPosture, outsideProjectMode, outsideProjectReadDenied, type FilesystemPolicy } from "./classify.ts";

const READ_COMMANDS = new Set([
	"ls", "cat", "find", "grep", "rg", "ag", "ack", "fd", "head", "tail", "stat", "file",
	"tree", "wc", "readlink", "realpath", "sed", "awk", "less", "more", "du", "bat", "nl",
	"strings", "xxd", "od", "cd", "pushd", "popd", "dirname", "basename", "cp", "mv",
	"install", "dd", "tar", "zip", "unzip", "gzip", "gunzip", "zcat", "bzip2", "xz", "zstd",
	"base64", "openssl", "gpg", "jq", "yq", "node", "deno", "bun", "python", "python2",
	"python3", "perl", "ruby", "php", "lua", "git", "gh", "docker", "kubectl", "aws", "gcloud",
	"az", "vault", "pass", "ssh", "scp", "rsync", "curl", "wget", "sqlite3", "psql", "mysql",
	"mongosh", "redis-cli", "java", "dotnet", "cargo", "tee", "xargs", "parallel", "tr",
]);

const RECURSIVE_SEARCH_COMMANDS = new Set(["grep", "rg", "ag", "ack", "find", "tree", "du", "fd"]);

export { shellSegments, shellTokens } from "./shell-command.ts";
export type { PathCandidateOptions } from "./path-tokens.ts";

function readPathCandidates(
	command: string,
	workingDirectory: string,
	homeDirectory: string,
	checkFileExists: (path: string) => boolean,
	options: PathCandidateOptions,
): string[] {
	const foundPaths = new Set<string>();

	for (const segment of commandSegments(command)) {
		const tokens = shellTokens(segment);
		const { head, headIndex } = commandHead(tokens);

		if (!READ_COMMANDS.has(head)) continue;

		const isRecursiveSearch = RECURSIVE_SEARCH_COMMANDS.has(head);

		for (const rawToken of tokens.slice(headIndex + 1)) {
			for (const token of embeddedPathTokens(rawToken)) {
				for (const absolutePath of resolveTokenPaths(token, workingDirectory, homeDirectory, options)) {
					if (isRecursiveSearch) {
						for (const listedFile of (options.listDirectory ?? listDirectoryFiles)(absolutePath)) {
							foundPaths.add(normalizeAbs(listedFile));
						}
					}

					if (checkFileExists(absolutePath)) foundPaths.add(absolutePath);
				}
			}
		}
	}

	return [...foundPaths];
}

export function outsideProjectReadCandidates(
	command: string,
	workingDirectory: string,
	homeDirectory: string,
	filesystem: FilesystemPolicy,
	checkFileExists: (path: string) => boolean = existsSync,
	resolvePath: (path: string) => string = (path) => path,
	options: PathCandidateOptions = {},
): string[] {
	const candidates = new Set(
		readPathCandidates(command, workingDirectory, homeDirectory, checkFileExists, options).map(resolvePath),
	);

	return [...candidates].filter(
		(candidatePath) =>
			!somePatternMatches(candidatePath, filesystem.denyRead, workingDirectory, homeDirectory) &&
			outsideProjectReadDenied(candidatePath, workingDirectory, homeDirectory, filesystem),
	);
}

export function askReadCandidates(
	command: string,
	workingDirectory: string,
	homeDirectory: string,
	filesystem: FilesystemPolicy,
	checkFileExists: (path: string) => boolean = existsSync,
	resolvePath: (path: string) => string = (path) => path,
	options: PathCandidateOptions = {},
): string[] {
	const askReadPatterns = filesystem.askRead ?? [];

	if (!askReadPatterns.length) {
		return [];
	}

	const candidates = new Set(
		readPathCandidates(command, workingDirectory, homeDirectory, checkFileExists, options).map(resolvePath),
	);

	return [...candidates].filter(
		(candidatePath) =>
			!somePatternMatches(candidatePath, filesystem.denyRead, workingDirectory, homeDirectory) &&
			somePatternMatches(candidatePath, askReadPatterns, workingDirectory, homeDirectory),
	);
}

export function commandMentionsPath(
	command: string,
	absolutePath: string,
	workingDirectory: string,
	homeDirectory: string,
	options: PathCandidateOptions = {},
): boolean {
	const targetPath = normalizeAbs(absolutePath);
	const targetBasename = basename(targetPath);

	for (const segment of commandSegments(command)) {
		for (const rawToken of shellTokens(segment)) {
			if (rawToken === targetBasename) return true;

			for (const token of embeddedPathTokens(rawToken)) {
				const matches = resolveTokenPaths(token, workingDirectory, homeDirectory, options);

				if (matches.some((match) => match === targetPath)) return true;
			}
		}
	}

	return false;
}

export function sandboxFilesystem(
	filesystem: FilesystemPolicy,
	options: { cwd: string; home: string },
): { denyRead: string[]; allowRead: string[]; allowWrite: string[]; denyWrite: string[] } {
	const denyRead = toSandboxPatterns(filesystem.denyRead);
	const allowRead = toSandboxPatterns(filesystem.allowRead ?? []);

	if (outsideProjectMode(filesystem) !== ReadPosture.Allow) {
		for (const fencePath of [options.home, dirname(options.cwd)]) {
			if (fencePath && fencePath !== "/" && !denyRead.includes(fencePath)) {
				denyRead.push(fencePath);
			}
		}

		const grants = [options.cwd, ...filesystem.allowWrite, ...(filesystem.outsideProject?.allowRead ?? [])];

		for (const grant of grants) {
			const pattern = toSandboxPatterns([grant])[0];

			if (!allowRead.includes(pattern)) {
				allowRead.push(pattern);
			}
		}
	}

	return {
		denyRead,
		allowRead,
		allowWrite: [...filesystem.allowWrite],
		denyWrite: toSandboxPatterns(filesystem.denyWrite),
	};
}
