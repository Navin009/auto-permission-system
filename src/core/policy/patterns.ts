/**
 * Path pattern matching shared by both layers. Pure: no pi, no OS side effects.
 */

// ---------- Layer 1 violation attribution ----------

/**
 * Filesystem-refusal evidence in a sandboxed command's output. Linux
 * bubblewrap reports a write outside `allowWrite` as `EROFS: read-only file
 * system`; macOS sandbox-exec reports the same fence as `Operation not
 * permitted`; EACCES covers a permission-denied variant either can print.
 */
const FS_BLOCKED_RE = /operation not permitted|EPERM|EACCES|EROFS|read-only file system/i;

/**
 * `EROFS` can only come from a modification, so it proves the refused access
 * was a write even when the target path also matches a read-deny pattern.
 * EPERM/EACCES are ambiguous about direction.
 */
const WRITE_BLOCK_RE = /EROFS|read-only file system/i;

/** True when the output shows the OS sandbox refused a filesystem access. */
export function isBlockedAccessError(output: string): boolean {
	return FS_BLOCKED_RE.test(output);
}

/** True when the refused access was a write (EROFS only happens on a modification). */
export function isWriteBlockError(output: string): boolean {
	return WRITE_BLOCK_RE.test(output);
}

/** A shell-name/empty token is not a path; everything else resolves against cwd unless absolute. */
function toAbsPath(raw: string, cwd: string, home: string): string | undefined {
	let token = raw.trim().replace(/[.,;]+$/, "");
	if (!token || /^(bash|sh|zsh)$/.test(token)) return undefined;
	if (token === "~" || token.startsWith("~/")) token = home + token.slice(1);
	const abs = token.startsWith("/") ? token : `${cwd.replace(/\/+$/, "")}/${token}`;
	return normalizeAbs(abs);
}

/**
 * The path a sandboxed bash command was refused, from its error output, as
 * an absolute path. Handles `tool: ./rel: Operation not permitted`, quoted
 * paths (`cannot touch 'x.pem'`), `~/…` and absolute paths, plus the
 * errno-style forms that put the path *after* the error text
 * (`EROFS: read-only file system, open '/abs/path'`,
 * `[Errno 30] Read-only file system: '/abs/path'`). Relative paths resolve
 * against the command's working directory, never against `/`.
 */
export function extractBlockedPath(output: string, cwd: string, home: string): string | undefined {
	for (const line of output.split("\n").reverse()) {
		const m = FS_BLOCKED_RE.exec(line);
		if (!m) continue;
		// errno-style messages (Node, Python, coreutils) put the operand in
		// quotes, usually after the error token: take the last quoted token.
		const quoted = [...line.matchAll(/['"“‘`]([^'"”’`]+)['"”’`]/g)].map((q) => q[1] as string);
		const quotedPath = quoted.length ? toAbsPath(quoted[quoted.length - 1] as string, cwd, home) : undefined;
		if (quotedPath) return quotedPath;
		// The segment right before the error text, e.g. "grep: ./.env: Operation…" → "./.env".
		const before = line.slice(0, m.index).replace(/[\s:]+$/, "");
		const segment = before.split(/:\s+/).pop() ?? "";
		const token = toAbsPath(segment.split(/\s+/).pop() ?? "", cwd, home);
		if (token) return token;
	}
	return undefined;
}

export function normalizeAbs(p: string): string {
	const out: string[] = [];
	for (const part of p.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") out.pop();
		else out.push(part);
	}
	return `/${out.join("/")}`;
}

/** A folder Layer 1 may offer as a one-click write grant: never `/`, the home folder, or anything above it. */
export function isSafeFolderGrant(dir: string, home: string): boolean {
	const d = normalizeAbs(dir);
	const h = normalizeAbs(home);
	return d !== "/" && d !== h && !h.startsWith(`${d}/`);
}

/**
 * Whether an absolute path matches one of the policy's path patterns, with the
 * same semantics as Layer 2: `/…` and `~/…` are full-path prefixes or globs,
 * `.` is the project root, anything else matches the basename (glob allowed).
 */
export function matchesPolicyPattern(absPath: string, pattern: string, cwd: string, home: string): boolean {
	let p = pattern;
	if (p === "~") p = home;
	else if (p.startsWith("~/")) p = `${home}/${p.slice(2)}`;
	const ci = process.platform === "darwin" ? "i" : "";
	const glob = (s: string) => {
		const body = s
			.replace(/[.+^${}()|[\]\\]/g, "\\$&")
			.split("**")
			.map((part) => part.replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]"))
			.join(".*");
		return new RegExp(`^${body}$`, ci);
	};
	if (p === ".") return absPath === cwd || absPath.startsWith(`${cwd}/`);
	if (p.startsWith("/")) {
		if (p.includes("*")) return glob(p).test(absPath);
		return absPath === p || absPath.startsWith(`${p}/`);
	}
	const base = absPath.slice(absPath.lastIndexOf("/") + 1);
	if (p.includes("*")) return glob(p).test(base);
	return ci ? base.toLowerCase() === p.toLowerCase() : base === p;
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
	return patterns.map((p) => (p === "." || p.includes("/") || p.startsWith("~") ? p : `**/${p}`));
}
