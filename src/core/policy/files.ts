import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { normalizeMode, type PermissionMode } from "./mode";

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
 * Set `mode` in a policy file in place, preserving its other fields (ADR-018).
 * Used by `/permission-mode` and the Shift+S shortcut. Creates the file when it
 * is absent; refuses to overwrite one that does not parse.
 */
export function setPolicyMode(path: string, mode: PermissionMode): void {
	const policy = readPolicyForUpdate(path);
	policy.mode = normalizeMode(mode);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(policy, null, 2)}\n`);
}
