/**
 * Pure helpers shared by security-guard.ts (Layer 2) and sandbox/index.ts
 * (Layer 1). No pi imports, so security/tests/*.mjs can import this file
 * directly (Node 24 strips the types) instead of re-implementing it.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Default read-deny list, shared by both layers so they cannot drift.
 * `~/.pi/agent` holds `mcp.json` (which can carry API keys), session
 * transcripts and caches; only `auth.json` was guarded before. It is a
 * default deny so Layer 1 (bash) is covered too, not just the model tools.
 */
export const DEFAULT_DENY_READ = ["~/.ssh", "~/.aws", "~/.gnupg", "~/.pi/agent"];
export const DEFAULT_ALLOW_WRITE = [".", "/tmp"];
export const DEFAULT_DENY_WRITE = [".env", ".env.*", "*.pem", "*.key"];

/**
 * Check that a policy file, if present, parses as JSON. Returns the parse
 * error message, or null when the file is absent or valid.
 *
 * Both layers fall back to their built-in defaults when a file does not
 * parse. That fallback is silent from the user's point of view unless the
 * caller surfaces this result: a single trailing comma otherwise disables a
 * whole policy file without anyone noticing.
 */
export function policyFileError(path: string): string | null {
	if (!existsSync(path)) return null;
	try {
		JSON.parse(readFileSync(path, "utf-8"));
		return null;
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}
}

/**
 * Read a policy file for an in-place update ("always" prompt tiers).
 * Absent file: empty object. Unparseable file: throws, so the caller never
 * overwrites a hand-written policy it could not read.
 */
export function readPolicyForUpdate(path: string): Record<string, unknown> {
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch (e) {
		throw new Error(`refusing to overwrite ${path}: it does not parse as JSON (${e instanceof Error ? e.message : e})`);
	}
}

/**
 * One line of pi's grep tool output: `path:N: text` for a match,
 * `path-N- text` for a context line. The separator is the same on both sides
 * of the line number, which keeps paths containing `-` or `:` parseable.
 */
const GREP_LINE = /^(.+?)([:-])(\d+)\2 /;

export interface GrepFilterResult {
	text: string;
	removedLines: number;
	removedFiles: string[];
}

/**
 * Remove grep output lines that come from denied files.
 *
 * `isDenied` receives the path exactly as grep printed it (relative to the
 * search root for a directory search). Lines that are not match or context
 * lines (`--` separators, truncation notices) are kept. Decisions are cached
 * per path.
 */
export function filterGrepOutput(text: string, isDenied: (printedPath: string) => boolean): GrepFilterResult {
	const cache = new Map<string, boolean>();
	const removedFiles = new Set<string>();
	let removedLines = 0;
	const kept: string[] = [];
	for (const line of text.split("\n")) {
		const m = GREP_LINE.exec(line);
		if (m) {
			const file = m[1];
			let denied = cache.get(file);
			if (denied === undefined) {
				denied = isDenied(file);
				cache.set(file, denied);
			}
			if (denied) {
				removedLines++;
				removedFiles.add(file);
				continue;
			}
		}
		kept.push(line);
	}
	return { text: kept.join("\n"), removedLines, removedFiles: [...removedFiles] };
}

// ---------- Layer 1 violation attribution ----------

const EPERM_RE = /operation not permitted|EPERM|EACCES/i;

/**
 * The path a sandboxed bash command was refused, from its error output, as
 * an absolute path. Handles `tool: ./rel: Operation not permitted`,
 * quoted paths (`cannot touch 'x.pem'`), `~/…` and absolute paths. Relative
 * paths resolve against the command's working directory, never against `/`.
 */
export function extractBlockedPath(output: string, cwd: string, home: string): string | undefined {
	for (const line of output.split("\n").reverse()) {
		const m = EPERM_RE.exec(line);
		if (!m) continue;
		// The segment right before the error text, e.g. "grep: ./.env: Operation…" → "./.env".
		const before = line.slice(0, m.index).replace(/[\s:]+$/, "");
		const segment = before.split(/:\s+/).pop() ?? "";
		const quoted = /['"“‘`]([^'"”’`]+)['"”’`]\s*$/.exec(segment);
		let token = (quoted?.[1] ?? segment.split(/\s+/).pop() ?? "").trim();
		if (!token || /^(bash|sh|zsh)$/.test(token)) continue;
		if (token === "~" || token.startsWith("~/")) token = home + token.slice(1);
		const abs = token.startsWith("/") ? token : `${cwd.replace(/\/+$/, "")}/${token}`;
		return normalizeAbs(abs);
	}
	return undefined;
}

function normalizeAbs(p: string): string {
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

// ---------- Outside the project (ADR-012 / ADR-014) ----------

/** The filesystem slice both layers read, with the Layer-2-only fields. */
export interface FilesystemPolicy {
	denyRead: readonly string[];
	allowWrite: readonly string[];
	denyWrite: readonly string[];
	allowRead?: readonly string[];
	/** Reads outside the project: "allow" (default), "ask" or "deny" (ADR-012). */
	outsideProject?: { read?: "allow" | "ask" | "deny"; allowRead?: string[] };
}

export function outsideProjectMode(fs: FilesystemPolicy): "allow" | "ask" | "deny" {
	return fs.outsideProject?.read ?? "allow";
}

/**
 * Whether `absPath` is an outside-the-project read the policy wants to gate:
 * outside cwd, not under an allowWrite / allowRead / outsideProject.allowRead
 * root, and mode !== "allow". Pure; mirrors Layer 2's outsideProjectReason for
 * callers (and tests) that cannot import security-guard.ts.
 */
export function outsideProjectReadDenied(absPath: string, cwd: string, home: string, fs: FilesystemPolicy): boolean {
	if (outsideProjectMode(fs) === "allow") return false;
	if (absPath === cwd || absPath.startsWith(`${cwd}/`)) return false;
	const allowed = [...fs.allowWrite, ...(fs.allowRead ?? []), ...(fs.outsideProject?.allowRead ?? [])];
	return !allowed.some((pat) => matchesPolicyPattern(absPath, pat, cwd, home));
}

// ---------- Layer 1 pre-flight ask (ADR-015) ----------

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
function shellSegments(command: string): string[] {
	return command.split(/\s*(?:;|&&|\|\||\||\n)\s*/).map((s) => s.trim()).filter(Boolean);
}

/** Tokenize one segment, dropping the quotes around fully quoted words. */
function shellTokens(segment: string): string[] {
	const out: string[] = [];
	const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(segment))) out.push(m[1] ?? m[2] ?? m[3] ?? "");
	return out;
}

/** A token that could name a path, expanded (`~`) but not yet resolved. */
function expandPathToken(token: string, home: string): string | undefined {
	const t = token.trim();
	if (!t || t.startsWith("-")) return undefined;
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return undefined; // URL, not a path
	if (t === "~") return home;
	if (t.startsWith("~/")) return `${home}/${t.slice(2)}`;
	const looksLikePath = t.startsWith("/") || t.startsWith("./") || t.startsWith("../") || t.includes("/");
	return looksLikePath ? t : undefined;
}

/**
 * Absolute paths a bash command **plainly** reads that are outside the project
 * and not already allowed (Layer 1 ask-tier, ADR-015). Best-effort: only
 * read-like segments, only tokens that exist on disk, never a hard `denyRead`
 * match. Obfuscated reads are not returned; the sidecar fence still covers
 * those, so the pre-flight ask is an improvement over silent masking, not a
 * replacement for the OS boundary.
 */
export function outsideProjectReadCandidates(
	command: string,
	cwd: string,
	home: string,
	fs: FilesystemPolicy,
	exists: (path: string) => boolean = existsSync,
): string[] {
	const found = new Set<string>();
	for (const segment of shellSegments(command)) {
		const tokens = shellTokens(segment);
		const head = (tokens[0] ?? "").split("/").pop() ?? "";
		if (!READ_COMMANDS.has(head)) continue;
		for (const raw of tokens.slice(1)) {
			const expanded = expandPathToken(raw, home);
			if (!expanded) continue;
			const abs = expanded.startsWith("/")
				? normalizeAbs(expanded)
				: normalizeAbs(`${cwd.replace(/\/+$/, "")}/${expanded}`);
			if (!exists(abs)) continue;
			if (fs.denyRead.some((pat) => matchesPolicyPattern(abs, pat, cwd, home))) continue;
			if (!outsideProjectReadDenied(abs, cwd, home, fs)) continue;
			found.add(abs);
		}
	}
	return [...found];
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
	fs: FilesystemPolicy,
	opts: { cwd: string; home: string },
): { denyRead: string[]; allowRead: string[]; allowWrite: string[]; denyWrite: string[] } {
	const denyRead = toSandboxPatterns(fs.denyRead);
	const allowRead = toSandboxPatterns(fs.allowRead ?? []);
	if (outsideProjectMode(fs) !== "allow") {
		for (const fence of [opts.home, dirname(opts.cwd)]) {
			if (fence && fence !== "/" && !denyRead.includes(fence)) denyRead.push(fence);
		}
		const grants = [opts.cwd, ...fs.allowWrite, ...(fs.outsideProject?.allowRead ?? [])];
		for (const grant of grants) {
			const p = toSandboxPatterns([grant])[0];
			if (!allowRead.includes(p)) allowRead.push(p);
		}
	}
	return { denyRead, allowRead, allowWrite: [...fs.allowWrite], denyWrite: toSandboxPatterns(fs.denyWrite) };
}
