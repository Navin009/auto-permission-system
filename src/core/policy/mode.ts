/**
 * Permission modes (ADR-018, ADR-020). Detection may only ADD asks; it never
 * downgrades a rule. Pure.
 *
 * `yolo` is the weakest tier: every layer is off. `MODE_ORDER` is weakest →
 * strictest, which is what the untrusted-project merge uses to decide whether a
 * project file may change `mode` (it may only move up).
 */

export type PermissionMode = "yolo" | "default" | "advanced-secure";

export const DEFAULT_MODE: PermissionMode = "default";

/** Weakest → strictest. Used by the untrusted-project tighten-only merge. */
export const MODE_ORDER: readonly PermissionMode[] = ["yolo", "default", "advanced-secure"];

/** Anything that is not one of the known modes resolves to the default. */
export function normalizeMode(value: unknown): PermissionMode {
	return value === "advanced-secure" || value === "yolo" ? value : DEFAULT_MODE;
}

export function modeLabel(mode: PermissionMode): string {
	if (mode === "advanced-secure") return "Advanced Secure";
	if (mode === "yolo") return "YOLO";
	return "Default";
}
