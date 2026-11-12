import { existsSync } from "node:fs";
import { basename, dirname } from "node:path";
import { firstMatchingPattern, normalizeAbs, somePatternMatches, toSandboxPatterns } from "./patterns.ts";
import { commandHead, commandSegments, shellTokens } from "./shell-command.ts";
import {
	embeddedPathTokens,
	listDirectoryFiles,
	resolveTokenPaths,
	type PathCandidateOptions,
} from "./path-tokens.ts";
import { findReadCandidates } from "./find-query.ts";
import { readTargetTokens } from "./operands.ts";
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

/**
 * Search tools that skip dotfiles unless told otherwise. `rg` and `fd` honour
 * hidden-file and ignore rules, so a walk of `.` that names `.env` is a
 * candidate the command will never open (ADR-050). `grep` and `ack` read
 * dotfiles, so they keep the file.
 */
const HIDDEN_SKIPPING_COMMANDS = new Set(["rg", "fd"]);

/** Flags that make a hidden-skipping command walk dotfiles too. */
const HIDDEN_VISIBILITY_FLAGS = new Set([
	"-u",
	"-uu",
	"-uuu",
	"--hidden",
	"--unrestricted",
	"--no-ignore",
	"--no-ignore-dot",
	"--no-ignore-global",
	"--no-ignore-parent",
	"--no-ignore-vcs",
]);

const NAME_ONLY_COMMANDS = new Set([
	"ls", "find", "tree", "du", "stat", "readlink", "realpath", "dirname", "basename",
	"cd", "pushd", "popd",
]);

export const ReadExposure = {
	Name: "name",
	Content: "content",
} as const;

export type ReadExposure = (typeof ReadExposure)[keyof typeof ReadExposure];

export interface ReadCandidate {
	path: string;
	exposure: ReadExposure;
}

export interface AskReadFinding extends ReadCandidate {
	pattern: string;
}

export { shellSegments, shellTokens } from "./shell-command.ts";
export type { PathCandidateOptions } from "./path-tokens.ts";

function recordCandidate(candidates: Map<string, ReadExposure>, absolutePath: string, exposure: ReadExposure): void {
	if (candidates.get(absolutePath) === ReadExposure.Content) return;

	candidates.set(absolutePath, exposure);
}

function isHiddenEntry(entryPath: string): boolean {
	return entryPath.slice(entryPath.lastIndexOf("/") + 1).startsWith(".");
}

function recordListedFiles(
	candidates: Map<string, ReadExposure>,
	absolutePath: string,
	exposure: ReadExposure,
	listDirectory: (absoluteDirectory: string) => string[],
	skipsHiddenEntries: boolean,
): void {
	for (const listedFile of listDirectory(absolutePath)) {
		if (skipsHiddenEntries && isHiddenEntry(listedFile)) continue;

		recordCandidate(candidates, normalizeAbs(listedFile), exposure);
	}
}

function readPathCandidates(
	command: string,
	workingDirectory: string,
	homeDirectory: string,
	checkFileExists: (path: string) => boolean,
	options: PathCandidateOptions,
): ReadCandidate[] {
	const foundCandidates = new Map<string, ReadExposure>();

	for (const segment of commandSegments(command)) {
		const tokens = shellTokens(segment);
		const { head, headIndex } = commandHead(tokens);

		if (!READ_COMMANDS.has(head)) continue;

		const exposure = NAME_ONLY_COMMANDS.has(head) ? ReadExposure.Name : ReadExposure.Content;

		if (head === "find") {
			const findCandidates = findReadCandidates(tokens.slice(headIndex + 1), workingDirectory, homeDirectory, checkFileExists, options);

			if (findCandidates) {
				for (const candidatePath of findCandidates) recordCandidate(foundCandidates, candidatePath, exposure);
				continue;
			}
		}

		const isRecursiveSearch = RECURSIVE_SEARCH_COMMANDS.has(head);
		const listDirectory = options.listDirectory ?? listDirectoryFiles;
		const skipsHiddenEntries =
			HIDDEN_SKIPPING_COMMANDS.has(head) && !tokens.some((token) => HIDDEN_VISIBILITY_FLAGS.has(token));

		for (const rawToken of readTargetTokens(head, tokens.slice(headIndex + 1))) {
			for (const token of embeddedPathTokens(rawToken)) {
				for (const absolutePath of resolveTokenPaths(token, workingDirectory, homeDirectory, options)) {
					if (isRecursiveSearch) {
						recordListedFiles(foundCandidates, absolutePath, exposure, listDirectory, skipsHiddenEntries);
					}

					if (checkFileExists(absolutePath)) recordCandidate(foundCandidates, absolutePath, exposure);
				}
			}
		}
	}

	return [...foundCandidates].map(([path, exposure]) => ({ path, exposure }));
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
		readPathCandidates(command, workingDirectory, homeDirectory, checkFileExists, options).map((candidate) =>
			resolvePath(candidate.path),
		),
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
	const findings = askReadFindings(
		command,
		workingDirectory,
		homeDirectory,
		filesystem,
		checkFileExists,
		resolvePath,
		options,
	);

	return findings.map((finding) => finding.path);
}

export function askReadFindings(
	command: string,
	workingDirectory: string,
	homeDirectory: string,
	filesystem: FilesystemPolicy,
	checkFileExists: (path: string) => boolean = existsSync,
	resolvePath: (path: string) => string = (path) => path,
	options: PathCandidateOptions = {},
): AskReadFinding[] {
	const askReadPatterns = filesystem.askRead ?? [];

	if (!askReadPatterns.length) {
		return [];
	}

	const findings = new Map<string, AskReadFinding>();

	for (const candidate of readPathCandidates(command, workingDirectory, homeDirectory, checkFileExists, options)) {
		const candidatePath = normalizeAbs(resolvePath(candidate.path));

		if (somePatternMatches(candidatePath, filesystem.denyRead, workingDirectory, homeDirectory)) continue;

		const pattern = firstMatchingPattern(candidatePath, askReadPatterns, workingDirectory, homeDirectory);

		if (!pattern) continue;

		const existing = findings.get(candidatePath);

		if (existing && existing.exposure === ReadExposure.Content) continue;

		findings.set(candidatePath, { path: candidatePath, exposure: candidate.exposure, pattern });
	}

	return [...findings.values()];
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
