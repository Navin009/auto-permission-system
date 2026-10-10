/**
 * The filesystem slice both layers read, plus the outside-project boundary
 * (ADR-012) it is enforced through. Pure: no pi, no OS side effects.
 */

import { matchesPolicyPattern } from "./patterns";

/** Erasable enum for `filesystem.outsideProject.read`. */
export const ReadPosture = {
	Allow: "allow",
	Ask: "ask",
	Deny: "deny",
} as const;
export type ReadPosture = (typeof ReadPosture)[keyof typeof ReadPosture];

export interface FilesystemPolicy {
	denyRead: readonly string[];
	allowWrite: readonly string[];
	denyWrite: readonly string[];
	allowRead?: readonly string[];
	/** Paths that prompt on read instead of being hard-denied (ADR-019). */
	askRead?: readonly string[];
	/** Reads outside the project: `allow` (default), `ask` or `deny` (ADR-012). */
	outsideProject?: { read?: ReadPosture; allowRead?: string[] };
}

export function outsideProjectMode(filesystem: FilesystemPolicy): ReadPosture {
	return filesystem.outsideProject?.read ?? ReadPosture.Allow;
}

/**
 * Whether `absPath` is an outside-the-project read the policy wants to gate:
 * outside cwd, not under an allowWrite / allowRead / outsideProject.allowRead
 * root, and mode !== `allow`. Pure; mirrors Layer 2's outsideProjectReason for
 * callers (and tests) that cannot import security-guard.ts.
 */
export function outsideProjectReadDenied(absPath: string, cwd: string, home: string, filesystem: FilesystemPolicy): boolean {
	if (outsideProjectMode(filesystem) === ReadPosture.Allow) return false;
	if (absPath === cwd || absPath.startsWith(`${cwd}/`)) return false;
	const allowed = [...filesystem.allowWrite, ...(filesystem.allowRead ?? []), ...(filesystem.outsideProject?.allowRead ?? [])];
	return !allowed.some((pattern) => matchesPolicyPattern(absPath, pattern, cwd, home));
}
