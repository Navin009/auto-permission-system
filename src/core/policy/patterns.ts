/**
 * Path pattern matching shared by both layers. Pure: no pi, no OS side effects.
 *
 * It also owns Layer 1's violation attribution: the evidence patterns that
 * recognise a refused filesystem access and recover the operand path from a
 * sandboxed command's output.
 */

/**
 * Filesystem-refusal evidence in a sandboxed command's output. Linux
 * bubblewrap reports a write outside `allowWrite` as `EROFS: read-only file
 * system`; macOS sandbox-exec reports the same fence as `Operation not
 * permitted`; EACCES covers a permission-denied variant either can print.
 */
const BLOCKED_ACCESS_RE = /operation not permitted|EPERM|EACCES|EROFS|read-only file system/i;

/**
 * `EROFS` can only come from a modification, so it proves the refused access
 * was a write even when the target path also matches a read-deny pattern.
 * EPERM/EACCES are ambiguous about direction.
 */
const WRITE_BLOCK_RE = /EROFS|read-only file system/i;

/** True when the output shows the OS sandbox refused a filesystem access. */
export function isBlockedAccessError(output: string): boolean {
	return BLOCKED_ACCESS_RE.test(output);
}

/** True when the refused access was a write (EROFS only happens on a modification). */
export function isWriteBlockError(output: string): boolean {
	return WRITE_BLOCK_RE.test(output);
}

/** A shell-name/empty token is not a path; everything else resolves against cwd unless absolute. */
function toAbsolutePath(rawToken: string, cwd: string, home: string): string | undefined {
	let token = rawToken.trim().replace(/[.,;]+$/, "");
	if (!token || /^(bash|sh|zsh)$/.test(token)) return undefined;
	if (token === "~" || token.startsWith("~/")) token = home + token.slice(1);
	const absolute = token.startsWith("/") ? token : `${cwd.replace(/\/+$/, "")}/${token}`;
	return normalizeAbs(absolute);
}

/**
 * The path a sandboxed bash command was refused, from its error output, as an
 * absolute path. Handles `tool: ./rel: Operation not permitted`, quoted paths
 * (`cannot touch 'x.pem'`), `~/…` and absolute paths, plus the errno-style
 * forms that put the path *after* the error text
 * (`EROFS: read-only file system, open '/abs/path'`,
 * `[Errno 30] Read-only file system: '/abs/path'`). Relative paths resolve
 * against the command's working directory, never against `/`.
 */
export function extractBlockedPath(output: string, cwd: string, home: string): string | undefined {
	for (const line of [...output.split("\n")].reverse()) {
		const match = BLOCKED_ACCESS_RE.exec(line);
		if (!match) continue;
		const quotedTokens = [...line.matchAll(/['"“‘`]([^'"”’`]+)['"”’`]/g)].map((quote) => quote[1] as string);
		const quotedPath = toAbsolutePath(quotedTokens.at(-1) ?? "", cwd, home);
		if (quotedPath) return quotedPath;
		const beforeError = line.slice(0, match.index).replace(/[\s:]+$/, "");
		const candidate = beforeError.split(/:\s+/).pop() ?? "";
		const resolved = toAbsolutePath(candidate.split(/\s+/).pop() ?? "", cwd, home);
		if (resolved) return resolved;
	}
	return undefined;
}

/** Collapse `.` and `..` segments to a canonical absolute path (no filesystem access). */
export function normalizeAbs(path: string): string {
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	return `/${parts.join("/")}`;
}

/** A folder Layer 1 may offer as a one-click write grant: never `/`, the home folder, or anything above it. */
export function isSafeFolderGrant(directory: string, home: string): boolean {
	const normalizedDirectory = normalizeAbs(directory);
	const normalizedHome = normalizeAbs(home);
	return normalizedDirectory !== "/" && normalizedDirectory !== normalizedHome && !normalizedHome.startsWith(`${normalizedDirectory}/`);
}

/**
 * Whether an absolute path matches one of the policy's path patterns, with the
 * same semantics as Layer 2: `/…` and `~/…` are full-path prefixes or globs,
 * `.` is the project root, anything else matches the basename (glob allowed).
 */
export function matchesPolicyPattern(absPath: string, pattern: string, cwd: string, home: string): boolean {
	let expandedPattern = pattern;
	if (expandedPattern === "~") expandedPattern = home;
	else if (expandedPattern.startsWith("~/")) expandedPattern = `${home}/${expandedPattern.slice(2)}`;
	const caseInsensitiveFlag = process.platform === "darwin" ? "i" : "";
	const compileGlob = (source: string): RegExp => {
		const body = source
			.replace(/[.+^${}()|[\]\\]/g, "\\$&")
			.split("**")
			.map((part) => part.replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]"))
			.join(".*");
		return new RegExp(`^${body}$`, caseInsensitiveFlag);
	};
	if (expandedPattern === ".") return absPath === cwd || absPath.startsWith(`${cwd}/`);
	if (expandedPattern.startsWith("/")) {
		if (expandedPattern.includes("*")) return compileGlob(expandedPattern).test(absPath);
		return absPath === expandedPattern || absPath.startsWith(`${expandedPattern}/`);
	}
	const basename = absPath.slice(absPath.lastIndexOf("/") + 1);
	if (expandedPattern.includes("*")) return compileGlob(expandedPattern).test(basename);
	return caseInsensitiveFlag ? basename.toLowerCase() === expandedPattern.toLowerCase() : basename === expandedPattern;
}

/**
 * Translate policy path patterns for sandbox-runtime (Layer 1).
 *
 * Layer 2 treats an entry without `/` or `~` (".env", "*.key") as a file name
 * that matches anywhere. sandbox-runtime resolves the same entry against the
 * working directory, so ".env" covered only `<cwd>/.env` and "*.key" only
 * top-level files; `sub/.env` stayed readable from bash. Prefix such entries
 * with `**\/` so both layers mean the same thing. `.` and entries with a path
 * are passed through unchanged.
 */
export function toSandboxPatterns(patterns: readonly string[]): string[] {
	return patterns.map((pattern) => (pattern === "." || pattern.includes("/") || pattern.startsWith("~") ? pattern : `**/${pattern}`));
}
