/** Permission modes (ADR-018). Detection may only ADD asks; it never downgrades a rule. Pure. */

export type PermissionMode = "default" | "advanced-secure";

export const DEFAULT_MODE: PermissionMode = "default";

/** `advanced-secure` is the stricter tier; used by the untrusted-project merge. */
export const MODE_ORDER: readonly PermissionMode[] = ["default", "advanced-secure"];

/** Anything that is not exactly `"advanced-secure"` resolves to the default. */
export function normalizeMode(value: unknown): PermissionMode {
	return value === "advanced-secure" ? "advanced-secure" : DEFAULT_MODE;
}

export function modeLabel(mode: PermissionMode): string {
	return mode === "advanced-secure" ? "Advanced Secure" : "Default";
}
