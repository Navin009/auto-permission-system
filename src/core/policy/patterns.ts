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

/**
 * Loopback / localhost connection refusal evidence in a sandboxed command's output.
 * On Linux, bubblewrap runs with --unshare-net which isolates network namespaces.
 * Host services listening on 127.0.0.1/localhost (like Diffusion Studio on port 3274,
 * or local dev servers) are not reachable from inside the container namespace.
 */
const LOOPBACK_REFUSAL_RE =
	/(?:Failed to connect to (?:127\.0\.0\.1|localhost|::1)|(?:connect|connection refused).*?(?:127\.0\.0\.1|localhost|::1)|(?:127\.0\.0\.1|localhost|::1).*?(?:connection refused|ECONNREFUSED)|ECONNREFUSED.*?(?:127\.0\.0\.1|localhost|::1)|Diffusion Studio is not running)/i;

/** True when the command failed due to connecting to a loopback/localhost address in the sandbox. */
export function isLoopbackConnectionRefused(output: string): boolean {
	return LOOPBACK_REFUSAL_RE.test(output);
}

export interface LoopbackEndpointInfo {
	host: string;
	port?: string;
	service?: string;
}

/**
 * Extract endpoint metadata (host, port, service name) from a loopback connection failure.
 */
export function extractLoopbackEndpoint(output: string, command?: string): LoopbackEndpointInfo | undefined {
	if (!isLoopbackConnectionRefused(output)) return undefined;

	const isDiffusion = /diffusion studio is not running/i.test(output) || (command && /\b(?:dapi|diffusion)\b/i.test(command));
	if (isDiffusion) {
		return { host: "127.0.0.1", port: "3274", service: "Diffusion Studio" };
	}

	const curlMatch = output.match(/Failed to connect to (127\.0\.0\.1|localhost|::1) port (\d+)/i);
	if (curlMatch) {
		return {
			host: curlMatch[1],
			port: curlMatch[2],
			service: curlMatch[2] === "3274" ? "Diffusion Studio" : undefined,
		};
	}

	const nodeMatch = output.match(/(?:ECONNREFUSED|connect to)\s+(127\.0\.0\.1|localhost|::1)(?::| port )(\d+)/i);
	if (nodeMatch) {
		return {
			host: nodeMatch[1],
			port: nodeMatch[2],
			service: nodeMatch[2] === "3274" ? "Diffusion Studio" : undefined,
		};
	}

	const hostMatch = output.match(/(127\.0\.0\.1|localhost|::1)/i);
	return { host: hostMatch ? hostMatch[1] : "127.0.0.1" };
}

export interface LoopbackAttributionContext {
	code: number | null;
	output: string;
	command?: string;
	allowLocalhost: boolean;
	platform?: NodeJS.Platform;
	bridgedPorts?: readonly number[];
}

export interface LoopbackBlockAttribution {
	blocked: boolean;
	endpoint?: LoopbackEndpointInfo;
}

/**
 * Determine whether a command exit code and output represents a loopback connection
 * failure genuinely caused by sandbox network isolation.
 *
 * If localhost is enabled (`allowLocalhost: true`), or if the destination port is
 * forwarded to the host via port bridging, any failure is an application/host-side issue
 * (e.g. service down), NOT a sandbox policy block.
 */
export function attributeLoopbackFailure(ctx: LoopbackAttributionContext): LoopbackBlockAttribution {
	if (ctx.code === 0) return { blocked: false };
	if (ctx.allowLocalhost) return { blocked: false };
	if (ctx.platform !== undefined && ctx.platform !== "linux") return { blocked: false };
	if (!isLoopbackConnectionRefused(ctx.output)) return { blocked: false };

	const endpoint = extractLoopbackEndpoint(ctx.output, ctx.command);
	if (endpoint?.port && ctx.bridgedPorts) {
		const portNum = parseInt(endpoint.port, 10);
		if (Number.isFinite(portNum) && ctx.bridgedPorts.includes(portNum)) {
			return { blocked: false, endpoint };
		}
	}

	return { blocked: true, endpoint };
}

/** A shell-name/empty token is not a path; everything else resolves against cwd unless absolute. */
function toAbsolutePath(rawToken: string, cwd: string, home: string): string | undefined {
	let token = rawToken.trim().replace(/[.,;:]+$/, "");
	if (!token || /^(bash|sh|zsh|EROFS)$/i.test(token)) return undefined;
	token = token.replace(/\/EROFS$/i, "");
	if (!token) return undefined;
	if (token === "~" || token.startsWith("~/")) token = home + token.slice(1);
	const absolute = token.startsWith("/") ? token : `${cwd.replace(/\/+$/, "")}/${token}`;
	return normalizeAbs(absolute);
}

/**
 * Strip the diagnostic lead-in that precedes an unquoted operand so the whole
 * operand survives (`open /path with spaces/file` -> `/path with spaces/file`).
 * Handles the `[pid:...]` prefix runtimes print before errno-style messages and
 * the coreutils verbs (`cannot touch`, `cannot remove`, ...).
 */
function stripErrnoLeadIn(text: string): string {
	const withoutPidPrefix = text.replace(/^\[[^\]]*\]\s*/, "");
	return withoutPidPrefix
		.replace(/^bwrap:\s*/i, "")
		.replace(/^(?:open|cannot (?:touch|remove|create|open|stat|access)|(?:can't|failed to) create file|touch|creat|unlink|mkdir|rmdir|rename)\s+/i, "")
		.trim();
}

/**
 * Whether a recovered operand really names a file. Operation words that appear
 * in diagnostics (`socket`, `display`, `failed`, `Failed to open socket`) are
 * not paths; a path either is rooted, contains a separator, or carries an
 * extension. A candidate with whitespace must contain a separator, so a
 * sentence like `. socket() failed` is rejected while `Crash Reports/x.dmp`
 * (an unquoted path with a space) is kept.
 */
function looksLikePath(token: string): boolean {
	if (!token) return false;
	if (/\s/.test(token)) return token.includes("/");
	if (token.startsWith("/") || token.startsWith("~")) return true;
	if (token.startsWith(".")) return true;
	return token.includes("/") || token.includes(".");
}

/**
 * The path a sandboxed bash command was refused, from its error output, as an
 * absolute path. Handles `tool: ./rel: Operation not permitted`, quoted paths
 * (`cannot touch 'x.pem'`), `~/…` and absolute paths, plus the errno-style
 * forms that put the path *after* the error text
 * (`EROFS: read-only file system, open '/abs/path'`,
 * `[Errno 30] Read-only file system: '/abs/path'`). A path with spaces keeps
 * its spaces (`open /…/Crash Reports/new/x.dmp`) while operation words
 * (`socket`, `display`) are not mistaken for files. A `bwrap: Can't create
 * file <path>` line is the OS sandbox failing to build its own mount mask, but
 * its path is still recovered so the caller can report it as a setup problem.
 * Relative paths resolve against the command's working directory, never
 * against `/`.
 */
export function extractBlockedPath(output: string, cwd: string, home: string): string | undefined {
	for (const line of [...output.split("\n")].reverse()) {
		const match = BLOCKED_ACCESS_RE.exec(line);
		if (!match) continue;
		const quotedTokens = [...line.matchAll(/['"“‘`]([^'"”’`]+)['"”’`]/g)].map((quote) => quote[1] as string);
		const quotedPath = toAbsolutePath(quotedTokens.at(-1) ?? "", cwd, home);
		if (quotedPath) return quotedPath;
		const beforeError = line.slice(0, match.index).replace(/[\s:]+$/, "");
		const candidate = stripErrnoLeadIn(beforeError.split(/:\s+/).pop() ?? "");
		if (!looksLikePath(candidate)) continue;
		const resolved = toAbsolutePath(candidate, cwd, home);
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
