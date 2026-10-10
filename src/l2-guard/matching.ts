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
import { ReadPosture } from "../core/index";
import type { Policy } from "./policy";

export function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return `${homedir()}/${path.slice(2)}`;
	return path;
}

/** Convert glob to RegExp. Supports `*`, `**`, `?`. */
function globToRegex(pattern: string): RegExp {
	const source =
		"^" +
		pattern
			.replace(/[.+^${}()|[\]\\]/g, "\\$&")
			.replace(/\*\*/g, "\x00")
			.replace(/\*/g, "[^/]*")
			.replace(/\x00/g, ".*")
			.replace(/\?/g, "[^/]") +
		"$";
	return new RegExp(source, process.platform === "darwin" ? "i" : "");
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
export function canonicalize(path: string, cwd: string): string {
	const absolute = isAbsolute(path) ? path : resolve(cwd, path);
	const suffix: string[] = [];
	let current = absolute;
	while (true) {
		try {
			const resolved = realpathSync(current);
			return suffix.length ? `${resolved}/${suffix.slice().reverse().join("/")}` : resolved;
		} catch {
			const parent = dirname(current);
			if (parent === current) return absolute;
			suffix.push(basename(current));
			current = parent;
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
	const expandedPattern = expandHome(pattern);
	if (expandedPattern === ".") {
		const resolvedCwd = canonicalize(cwd, cwd);
		return absPath === resolvedCwd || absPath.startsWith(`${resolvedCwd}/`);
	}
	if (expandedPattern.startsWith("/")) {
		if (expandedPattern.includes("*")) return globToRegex(expandedPattern).test(absPath);
		return absPath === expandedPattern || absPath.startsWith(`${expandedPattern}/`);
	}
	const basenameOfPath = basename(absPath);
	if (expandedPattern.includes("*")) return globToRegex(expandedPattern).test(basenameOfPath);
	return basenameOfPath === expandedPattern;
}

// Hardcoded absolute-deny tier (per PLAN-ask-tier-ux.md OQ#5).
// Allowing one call takes two select steps that default to block (ADR-009); "always" is forbidden.
// pi's own auth.json holds the provider OAuth tokens and API keys pi runs on.
const ABSOLUTE_DENY_PATTERNS = ["~/.ssh", "~/.gnupg", "~/.aws", "*.pem", "*.key", `${getAgentDir()}/auth.json`];

export function isAbsoluteDeny(absPath: string, cwd: string): string | null {
	for (const pattern of ABSOLUTE_DENY_PATTERNS) {
		if (matchPattern(absPath, pattern, cwd)) return pattern;
	}
	return null;
}

export function isOverridden(absPath: string, cwd: string, patterns: string[] | undefined): boolean {
	if (!patterns || patterns.length === 0) return false;
	return patterns.some((pattern) => matchPattern(absPath, pattern, cwd));
}

/**
 * The absolute-deny tier denies on its own, and it is checked before the
 * overrides: "always" is never offered for credentials. Before this, the tier
 * only chose the prompt shown after denyRead/denyWrite had already matched, so
 * `*.pem`, `*.key`, `~/.aws` and auth.json stayed readable under any policy
 * that did not list them.
 */
export function isDeniedRead(rawPath: string, cwd: string, policy: Policy): string | null {
	const absolute = canonicalize(rawPath, cwd);
	const absoluteDenyPattern = isAbsoluteDeny(absolute, cwd);
	if (absoluteDenyPattern) return `absolute-deny matched "${absoluteDenyPattern}" → ${absolute}`;
	if (isOverridden(absolute, cwd, policy.overrides?.allowRead)) return null;
	for (const pattern of policy.filesystem.modelDenyRead ?? []) {
		if (matchPattern(absolute, pattern, cwd)) return `modelDenyRead matched "${pattern}" → ${absolute}`;
	}
	for (const pattern of policy.filesystem.denyRead) {
		if (matchPattern(absolute, pattern, cwd)) return `denyRead matched "${pattern}" → ${absolute}`;
	}
	return null;
}

/** A path the user chose to be asked about, not hard-denied (ADR-019). */
export function isAskRead(rawPath: string, cwd: string, policy: Policy): string | null {
	const absolute = canonicalize(rawPath, cwd);
	if (isOverridden(absolute, cwd, policy.overrides?.allowRead)) return null;
	for (const pattern of policy.filesystem.askRead ?? []) {
		if (matchPattern(absolute, pattern, cwd)) return `askRead matched "${pattern}" → ${absolute}`;
	}
	return null;
}

export function isDeniedWrite(rawPath: string, cwd: string, policy: Policy): string | null {
	const absolute = canonicalize(rawPath, cwd);
	const absoluteDenyPattern = isAbsoluteDeny(absolute, cwd);
	if (absoluteDenyPattern) return `absolute-deny matched "${absoluteDenyPattern}" → ${absolute}`;
	if (isOverridden(absolute, cwd, policy.overrides?.allowWrite)) return null;
	for (const pattern of policy.filesystem.denyWrite) {
		if (matchPattern(absolute, pattern, cwd)) return `denyWrite matched "${pattern}" → ${absolute}`;
	}
	const allowed = policy.filesystem.allowWrite.some((pattern) => matchPattern(absolute, pattern, cwd));
	if (!allowed) return `not under any allowWrite root → ${absolute}`;
	return null;
}

let piRootCache: string | null | undefined;

/** pi's own package directory (docs, examples), found from the running binary. */
export function piPackageRoot(): string | null {
	if (piRootCache !== undefined) return piRootCache;
	piRootCache = null;
	try {
		let directory = dirname(realpathSync(process.argv[1] ?? ""));
		for (let depth = 0; depth < 6; depth++) {
			const packageJsonPath = join(directory, "package.json");
			if (existsSync(packageJsonPath) && JSON.parse(readFileSync(packageJsonPath, "utf-8")).name === "@earendil-works/pi-coding-agent") {
				piRootCache = directory;
				break;
			}
			directory = dirname(directory);
		}
	} catch {
		/* not found: no built-in root */
	}
	return piRootCache;
}

export function outsideProjectReason(abs: string, cwd: string, policy: Policy): string | null {
	const mode = policy.filesystem.outsideProject?.read ?? ReadPosture.Allow;
	if (mode === ReadPosture.Allow) return null;
	const projectRoot = canonicalize(cwd, cwd);
	if (abs === projectRoot || abs.startsWith(`${projectRoot}/`)) return null;
	// The pi agent dir is deliberately NOT here: it holds mcp.json (API keys),
	// sessions and caches, so it must go through the outside-project gate. It is
	// in DEFAULT_DENY_READ as well, which also covers bash (ADR-014).
	const allowedRoots = [...policy.filesystem.allowWrite, ...(policy.filesystem.outsideProject?.allowRead ?? []), piPackageRoot()]
		.filter((root): root is string => !!root)
		.map((root) => (root.startsWith("/") ? canonicalize(root, cwd) : root));
	if (allowedRoots.some((root) => matchPattern(abs, root, cwd))) return null;
	if (isOverridden(abs, cwd, policy.overrides?.allowRead)) return null;
	return `outside the project (filesystem.outsideProject.read: ${mode}) → ${abs}`;
}
