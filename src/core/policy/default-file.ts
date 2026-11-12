/**
 * The shipped baseline policy (`sandbox.default.json` at the package root) is
 * the only place the default lists live — denyRead, allowWrite, denyWrite,
 * allowedDomains, askRead/askWrite. No list is repeated in code, so editing the
 * JSON is the one way to change a default and the two layers cannot drift.
 *
 * A policy still needs a shape when the file cannot be read: the closed shape
 * below states no path, domain or command, so a broken package layout leaves
 * the sandbox with nothing allowed rather than everything allowed.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { overlayPolicy } from "./merge.ts";
import { DEFAULT_MODE } from "./mode.ts";
import { SubagentNetwork } from "./subagent.ts";

const CLOSED_POLICY: Record<string, unknown> = {
	enabled: true,
	mode: DEFAULT_MODE,
	network: { allowedDomains: [], deniedDomains: [] },
	filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
	subagent: { network: SubagentNetwork.Allow },
};

const MAXIMUM_PARENT_DEPTH = 6;

/** Walk up from this module looking for the file the package ships. */
function findDefaultFile(): string | null {
	let directory = dirname(fileURLToPath(import.meta.url));
	for (let depth = 0; depth < MAXIMUM_PARENT_DEPTH; depth++) {
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
		}
	}
	cached = resolved;
	return resolved;
}

/** The baseline both layers start from: the shipped file over the closed shape. */
export function shippedPolicy(): Record<string, unknown> {
	return overlayPolicy(CLOSED_POLICY, loadDefaultPolicy() ?? {});
}
