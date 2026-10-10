/**
 * Persisted ask-tier overrides (ADR-007). Both layers write the same policy
 * file from their "remember" branch, so the read-modify-write lives here once:
 * appending a grant must preserve the other override kinds and every
 * hand-written key, and a trusted project file must stay trusted after its own
 * grant is written.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readPolicyForUpdate } from "./files";
import { recordProjectTrust } from "../trust";

/** Erasable enum for the three additive grant lists in `overrides`. */
export const OverrideKind = {
	AllowRead: "allowRead",
	AllowWrite: "allowWrite",
	AllowDomains: "allowDomains",
} as const;
export type OverrideKind = (typeof OverrideKind)[keyof typeof OverrideKind];

/** Erasable enum for where a grant is written. */
export const GrantScope = {
	Cwd: "cwd",
	Global: "global",
} as const;
export type GrantScope = (typeof GrantScope)[keyof typeof GrantScope];

type OverrideLists = Partial<Record<OverrideKind, string[]>>;

/**
 * Append `value` to `overrides[kind]` in `path`, preserving every other key.
 * Returns the path written. Throws when the file does not parse, so a
 * hand-written policy is never overwritten blind.
 */
export function addOverride(path: string, kind: OverrideKind, value: string): string {
	const existing = readPolicyForUpdate(path) as { overrides?: OverrideLists };
	const overrides = existing.overrides ?? {};
	const list = overrides[kind] ?? [];
	if (!list.includes(value)) list.push(value);
	overrides[kind] = list;
	existing.overrides = overrides;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(existing, null, 2)}\n`);
	return path;
}

/**
 * `addOverride` for a trusted project file: record the new content hash, so the
 * grant write itself does not invalidate the trust that allowed it (ADR-013).
 */
export function addProjectOverride(projectPath: string, storePath: string, kind: OverrideKind, value: string): string {
	const path = addOverride(projectPath, kind, value);
	recordProjectTrust(projectPath, storePath);
	return path;
}
