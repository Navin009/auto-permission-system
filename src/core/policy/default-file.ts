/**
 * Loads the shipped baseline policy (`sandbox.default.json`) that sits at the
 * package root. This is the lowest-priority layer: install = protected, and the
 * global/project files tune it on top.
 *
 * Robust by design: if the file is missing or unparseable the caller falls back
 * to the constants in `defaults.ts`, so a broken package layout never leaves
 * the sandbox wide open.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Walk up from this module looking for the file the package ships. */
function findDefaultFile(): string | null {
	let directory = dirname(fileURLToPath(import.meta.url));
	for (let depth = 0; depth < 6; depth++) {
		const candidate = join(directory, "sandbox.default.json");
		if (existsSync(candidate)) return candidate;
		const parent = dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	return null;
}

let cached: Record<string, unknown> | null | undefined;

/** The shipped baseline policy as a plain object, or null when it cannot be read. */
export function loadDefaultPolicy(): Record<string, unknown> | null {
	if (cached !== undefined) return cached;
	let resolved: Record<string, unknown> | null = null;
	const path = findDefaultFile();
	if (path) {
		try {
			const parsed = JSON.parse(readFileSync(path, "utf-8"));
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) resolved = parsed;
		} catch {
			/* fall back to the caller's constants */
		}
	}
	cached = resolved;
	return resolved;
}
