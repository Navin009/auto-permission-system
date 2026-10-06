import { matchesPolicyPattern } from "./patterns";

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
