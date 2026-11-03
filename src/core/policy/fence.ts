import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { matchesPolicyPattern, normalizeAbs, toSandboxPatterns } from "./patterns.ts";
import { ReadPosture, outsideProjectMode, outsideProjectReadDenied, type FilesystemPolicy } from "./classify.ts";

const READ_COMMANDS = new Set([
	"ls", "cat", "find", "grep", "rg", "fd", "head", "tail", "stat", "file",
	"tree", "wc", "readlink", "realpath", "sed", "awk", "less", "more", "du",
	"bat", "nl", "strings", "xxd", "od", "cd", "pushd", "popd", "dirname", "basename",
]);

export function shellSegments(command: string): string[] {
	return command
		.split(/\s*(?:;|&&|\|\||\||\n)\s*/)
		.map((segment) => segment.trim())
		.filter(Boolean);
}

export function shellTokens(segment: string): string[] {
	const tokens: string[] = [];
	const tokenPattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
	let match: RegExpExecArray | null;

	while ((match = tokenPattern.exec(segment))) {
		tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
	}

	return tokens;
}

function expandHomeToken(token: string, homeDirectory: string): string {
	if (token === "~") {
		return homeDirectory;
	}

	if (token.startsWith("~/")) {
		return `${homeDirectory}/${token.slice(2)}`;
	}

	return token;
}

function readPathCandidates(
	command: string,
	workingDirectory: string,
	homeDirectory: string,
	checkFileExists: (path: string) => boolean,
): string[] {
	const foundPaths = new Set<string>();

	for (const segment of shellSegments(command)) {
		const tokens = shellTokens(segment);
		const headCommand = (tokens[0] ?? "").split("/").pop() ?? "";

		if (!READ_COMMANDS.has(headCommand)) {
			continue;
		}

		for (const rawToken of tokens.slice(1)) {
			const token = rawToken.trim();

			if (!token || token.startsWith("-") || /^[a-z][a-z0-9+.-]*:\/\//i.test(token)) {
				continue;
			}

			const expandedPath = expandHomeToken(token, homeDirectory);
			const absolutePath = expandedPath.startsWith("/")
				? normalizeAbs(expandedPath)
				: normalizeAbs(`${workingDirectory.replace(/\/+$/, "")}/${expandedPath}`);

			if (checkFileExists(absolutePath)) {
				foundPaths.add(absolutePath);
			}
		}
	}

	return [...foundPaths];
}

function isNotDenied(
	absolutePath: string,
	workingDirectory: string,
	homeDirectory: string,
	filesystem: FilesystemPolicy,
): boolean {
	const hasDenial = filesystem.denyRead.some((pattern) =>
		matchesPolicyPattern(absolutePath, pattern, workingDirectory, homeDirectory),
	);

	return !hasDenial;
}

export function outsideProjectReadCandidates(
	command: string,
	workingDirectory: string,
	homeDirectory: string,
	filesystem: FilesystemPolicy,
	checkFileExists: (path: string) => boolean = existsSync,
	resolvePath: (path: string) => string = (path) => path,
): string[] {
	const candidates = new Set(readPathCandidates(command, workingDirectory, homeDirectory, checkFileExists).map(resolvePath));

	return [...candidates].filter(
		(candidatePath) =>
			isNotDenied(candidatePath, workingDirectory, homeDirectory, filesystem) &&
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
): string[] {
	const askReadPatterns = filesystem.askRead ?? [];

	if (!askReadPatterns.length) {
		return [];
	}

	const candidates = new Set(readPathCandidates(command, workingDirectory, homeDirectory, checkFileExists).map(resolvePath));

	return [...candidates].filter(
		(candidatePath) =>
			isNotDenied(candidatePath, workingDirectory, homeDirectory, filesystem) &&
			askReadPatterns.some((pattern) => matchesPolicyPattern(candidatePath, pattern, workingDirectory, homeDirectory)),
	);
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
