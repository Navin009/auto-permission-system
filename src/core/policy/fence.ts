/**
 * Layer 1's pre-flight path scan (ADR-015) and the `filesystem` block handed
 * to sandbox-runtime. Pure: no pi, no OS side effects.
 */

import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { matchesPolicyPattern, normalizeAbs, toSandboxPatterns } from "./patterns";
import { ReadPosture, outsideProjectMode, outsideProjectReadDenied, type FilesystemPolicy } from "./classify";

/**
 * Commands whose positional arguments are read targets. Layer 1's pre-flight
 * ask only inspects segments whose head is one of these, so `echo ~/.pi/agent`
 * (a literal, not a read) does not prompt. `cd` is included because the
 * segment after it reads relative to the directory it names.
 */
const READ_COMMANDS = new Set([
	"ls", "cat", "find", "grep", "rg", "fd", "head", "tail", "stat", "file",
	"tree", "wc", "readlink", "realpath", "sed", "awk", "less", "more", "du",
	"bat", "nl", "strings", "xxd", "od", "cd", "pushd", "popd", "dirname", "basename",
]);

/** Split a shell command on the operators that start a new simple command. */
export function shellSegments(command: string): string[] {
	return command.split(/\s*(?:;|&&|\|\||\||\n)\s*/).map((segment) => segment.trim()).filter(Boolean);
}

/** Tokenize one segment, dropping the quotes around fully quoted words. */
export function shellTokens(segment: string): string[] {
	const tokens: string[] = [];
	const tokenPattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
	let match: RegExpExecArray | null;
	while ((match = tokenPattern.exec(segment))) tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
	return tokens;
}

/** Expand a leading `~`; other tokens are returned as-is. */
function expandHomeToken(token: string, home: string): string {
	if (token === "~") return home;
	if (token.startsWith("~/")) return `${home}/${token.slice(2)}`;
	return token;
}

/**
 * Absolute paths named by read-like segments of a bash command. Best-effort:
 * only read-like heads, only tokens that exist on disk. Bare names count
 * (`.env` has no slash); the caller's pattern match decides. Obfuscated reads
 * are not returned — the OS fence covers those.
 */
function readPathCandidates(
	command: string,
	cwd: string,
	home: string,
	exists: (path: string) => boolean,
): string[] {
	const found = new Set<string>();
	for (const segment of shellSegments(command)) {
		const tokens = shellTokens(segment);
		const head = (tokens[0] ?? "").split("/").pop() ?? "";
		if (!READ_COMMANDS.has(head)) continue;
		for (const raw of tokens.slice(1)) {
			const token = raw.trim();
			if (!token || token.startsWith("-") || /^[a-z][a-z0-9+.-]*:\/\//i.test(token)) continue;
			const expanded = expandHomeToken(token, home);
			const absolute = expanded.startsWith("/")
				? normalizeAbs(expanded)
				: normalizeAbs(`${cwd.replace(/\/+$/, "")}/${expanded}`);
			if (exists(absolute)) found.add(absolute);
		}
	}
	return [...found];
}

/** Never a hard `denyRead` match, whatever the caller asks about. */
function notDenied(absPath: string, cwd: string, home: string, filesystem: FilesystemPolicy): boolean {
	return !filesystem.denyRead.some((pattern) => matchesPolicyPattern(absPath, pattern, cwd, home));
}

/**
 * Absolute paths a bash command **plainly** reads that are outside the project
 * and not already allowed (Layer 1 ask-tier, ADR-015).
 */
export function outsideProjectReadCandidates(
	command: string,
	cwd: string,
	home: string,
	filesystem: FilesystemPolicy,
	exists: (path: string) => boolean = existsSync,
): string[] {
	return readPathCandidates(command, cwd, home, exists).filter(
		(absPath) => notDenied(absPath, cwd, home, filesystem) && outsideProjectReadDenied(absPath, cwd, home, filesystem),
	);
}

/** Absolute paths a bash command **plainly** reads that match `filesystem.askRead` (ADR-019). */
export function askReadCandidates(
	command: string,
	cwd: string,
	home: string,
	filesystem: FilesystemPolicy,
	exists: (path: string) => boolean = existsSync,
): string[] {
	const askReadPatterns = filesystem.askRead ?? [];
	if (!askReadPatterns.length) return [];
	return readPathCandidates(command, cwd, home, exists).filter(
		(absPath) => notDenied(absPath, cwd, home, filesystem) && askReadPatterns.some((pattern) => matchesPolicyPattern(absPath, pattern, cwd, home)),
	);
}

/**
 * Build the `filesystem` block handed to sandbox-runtime (Layer 1).
 *
 * When the policy gates outside-project reads, sandbox-runtime has no
 * interactive prompt, so the boundary is enforced by fencing the home
 * directory (and the project's parent when it is not under home) with
 * `denyRead` and then re-exposing the project and the allowed roots with
 * `allowRead` — the runtime resolves `allowRead` as a re-allow *within* a
 * denied region. Explicit file denies keep winning over a directory
 * `allowRead`, so `.env` / `*.pem` / `~/.ssh` stay blocked. Without this,
 * `outsideProject` never reached Layer 1 at all and `bash` read anything.
 */
export function sandboxFilesystem(
	filesystem: FilesystemPolicy,
	options: { cwd: string; home: string },
): { denyRead: string[]; allowRead: string[]; allowWrite: string[]; denyWrite: string[] } {
	const denyRead = toSandboxPatterns(filesystem.denyRead);
	const allowRead = toSandboxPatterns(filesystem.allowRead ?? []);
	if (outsideProjectMode(filesystem) !== ReadPosture.Allow) {
		for (const fence of [options.home, dirname(options.cwd)]) {
			if (fence && fence !== "/" && !denyRead.includes(fence)) denyRead.push(fence);
		}
		const grants = [options.cwd, ...filesystem.allowWrite, ...(filesystem.outsideProject?.allowRead ?? [])];
		for (const grant of grants) {
			const pattern = toSandboxPatterns([grant])[0];
			if (!allowRead.includes(pattern)) allowRead.push(pattern);
		}
	}
	return { denyRead, allowRead, allowWrite: [...filesystem.allowWrite], denyWrite: toSandboxPatterns(filesystem.denyWrite) };
}
