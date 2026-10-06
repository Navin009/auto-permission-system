/**
 * Layer 2 path matching and classification: symlink-safe canonicalization,
 * policy pattern matching, the absolute-deny tier, and the outside-project
 * boundary (ADR-012).
 *
 * Adapter-free: imports only core + node builtins + the Policy type.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { Policy } from "./policy";

export function expandHome(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/")) return `${homedir()}/${p.slice(2)}`;
	return p;
}

/** Convert glob to RegExp. Supports `*`, `**`, `?`. */
function globToRegex(pattern: string): RegExp {
	const re =
		"^" +
		pattern
			.replace(/[.+^${}()|[\]\\]/g, "\\$&")
			.replace(/\*\*/g, "\x00")
			.replace(/\*/g, "[^/]*")
			.replace(/\x00/g, ".*")
			.replace(/\?/g, "[^/]") +
		"$";
	return new RegExp(re, process.platform === "darwin" ? "i" : "");
}

/**
 * Canonicalize a path for matching.
 *
 * - Resolved against cwd if relative.
 * - Walks up to the deepest existing ancestor and realpaths *that*, so
 *   symlinks in the path prefix are followed even when the leaf (or any
 *   intermediate) doesn't exist yet. Defeats the
 *   `cwd/symlink-to-ssh/anything` escape regardless of whether `anything`
 *   exists.
 */
export function canonicalize(p: string, cwd: string): string {
	const abs = isAbsolute(p) ? p : resolve(cwd, p);
	const trail: string[] = [];
	let cur = abs;
	while (true) {
		try {
			const real = realpathSync(cur);
			return trail.length ? `${real}/${trail.slice().reverse().join("/")}` : real;
		} catch {
			const parent = dirname(cur);
			if (parent === cur) return abs; // reached root; give up
			trail.push(basename(cur));
			cur = parent;
		}
	}
}

/**
 * Match an absolute path against a policy pattern.
 *
 *   - Patterns starting with `/` or `~` → full-path match (prefix or glob).
 *   - `.` → matches anything under cwd (handled by callers via roots).
 *   - Other (`.env`, `*.pem`) → basename match against the file's basename.
 */
export function matchPattern(absPath: string, pattern: string, cwd: string): boolean {
	const p = expandHome(pattern);
	if (p === ".") {
		const cwdReal = canonicalize(cwd, cwd);
		return absPath === cwdReal || absPath.startsWith(`${cwdReal}/`);
	}
	if (p.startsWith("/")) {
		if (p.includes("*")) return globToRegex(p).test(absPath);
		return absPath === p || absPath.startsWith(`${p}/`);
	}
	// basename pattern
	const base = basename(absPath);
	if (p.includes("*")) return globToRegex(p).test(base);
	return base === p;
}

// Hardcoded absolute-deny tier (per PLAN-ask-tier-ux.md OQ#5).
// Allowing one call takes two select steps that default to block (ADR-009); "always" is forbidden.
// pi's own auth.json holds the provider OAuth tokens and API keys pi runs on.
const ABSOLUTE_DENY_PATTERNS = ["~/.ssh", "~/.gnupg", "~/.aws", "*.pem", "*.key", `${getAgentDir()}/auth.json`];

export function isAbsoluteDeny(absPath: string, cwd: string): string | null {
	for (const pat of ABSOLUTE_DENY_PATTERNS) {
		if (matchPattern(absPath, pat, cwd)) return pat;
	}
	return null;
}

export function isOverridden(absPath: string, cwd: string, list: string[] | undefined): boolean {
	if (!list || list.length === 0) return false;
	return list.some((pat) => matchPattern(absPath, pat, cwd));
}

// The absolute-deny tier denies on its own. Before, it only chose the prompt
// shown after denyRead/denyWrite had already matched, so `*.pem`, `*.key`,
// `~/.aws` and auth.json stayed readable under any policy that did not list
// them. Checked before overrides: "always" is never offered for this tier.
export function isDeniedRead(rawPath: string, cwd: string, policy: Policy): string | null {
	const abs = canonicalize(rawPath, cwd);
	const absolute = isAbsoluteDeny(abs, cwd);
	if (absolute) return `absolute-deny matched "${absolute}" → ${abs}`;
	if (isOverridden(abs, cwd, policy.overrides?.allowRead)) return null;
	for (const pat of policy.filesystem.modelDenyRead ?? []) {
		if (matchPattern(abs, pat, cwd)) return `modelDenyRead matched "${pat}" → ${abs}`;
	}
	for (const pat of policy.filesystem.denyRead) {
		if (matchPattern(abs, pat, cwd)) return `denyRead matched "${pat}" → ${abs}`;
	}
	return null;
}

/** A path the user chose to be asked about, not hard-denied (ADR-019). */
export function isAskRead(rawPath: string, cwd: string, policy: Policy): string | null {
	const abs = canonicalize(rawPath, cwd);
	if (isOverridden(abs, cwd, policy.overrides?.allowRead)) return null;
	for (const pat of policy.filesystem.askRead ?? []) {
		if (matchPattern(abs, pat, cwd)) return `askRead matched "${pat}" → ${abs}`;
	}
	return null;
}

export function isDeniedWrite(rawPath: string, cwd: string, policy: Policy): string | null {
	const abs = canonicalize(rawPath, cwd);
	const absolute = isAbsoluteDeny(abs, cwd);
	if (absolute) return `absolute-deny matched "${absolute}" → ${abs}`;
	if (isOverridden(abs, cwd, policy.overrides?.allowWrite)) return null;
	for (const pat of policy.filesystem.denyWrite) {
		if (matchPattern(abs, pat, cwd)) return `denyWrite matched "${pat}" → ${abs}`;
	}
	const allowed = policy.filesystem.allowWrite.some((pat) => matchPattern(abs, pat, cwd));
	if (!allowed) return `not under any allowWrite root → ${abs}`;
	return null;
}

let piRootCache: string | null | undefined;

/** pi's own package directory (docs, examples), found from the running binary. */
export function piPackageRoot(): string | null {
	if (piRootCache !== undefined) return piRootCache;
	piRootCache = null;
	try {
		let d = dirname(realpathSync(process.argv[1] ?? ""));
		for (let i = 0; i < 6; i++) {
			const pj = join(d, "package.json");
			if (existsSync(pj) && JSON.parse(readFileSync(pj, "utf-8")).name === "@earendil-works/pi-coding-agent") {
				piRootCache = d;
				break;
			}
			d = dirname(d);
		}
	} catch {
		/* not found: no built-in root */
	}
	return piRootCache;
}

export function outsideProjectReason(abs: string, cwd: string, policy: Policy): string | null {
	const mode = policy.filesystem.outsideProject?.read ?? "allow";
	if (mode === "allow") return null;
	const root = canonicalize(cwd, cwd);
	if (abs === root || abs.startsWith(`${root}/`)) return null;
	// The pi agent dir is deliberately NOT here: it holds mcp.json (API keys),
	// sessions and caches, so it must go through the outside-project gate. It is
	// in DEFAULT_DENY_READ as well, which also covers bash (ADR-014).
	const roots = [...policy.filesystem.allowWrite, ...(policy.filesystem.outsideProject?.allowRead ?? []), piPackageRoot()]
		.filter((p): p is string => !!p)
		.map((p) => (p.startsWith("/") ? canonicalize(p, cwd) : p));
	if (roots.some((p) => matchPattern(abs, p, cwd))) return null;
	if (isOverridden(abs, cwd, policy.overrides?.allowRead)) return null;
	return `outside the project (filesystem.outsideProject.read: ${mode}) → ${abs}`;
}
