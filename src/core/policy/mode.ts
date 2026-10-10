/**
 * Permission modes (ADR-018, ADR-020). Detection may only ADD asks; it never
 * downgrades a rule. Pure.
 *
 * `yolo` is the weakest tier: every layer is off. `MODE_ORDER` is weakest →
 * strictest, which is what the untrusted-project merge uses to decide whether
 * a project file may change `mode` (it may only move up).
 */

/**
 * Erasable enum: named constants whose runtime values are the JSON strings, so
 * config files keep working. Node's type stripping cannot run a TS `enum`.
 */
export const PermissionMode = {
	Yolo: "yolo",
	Default: "default",
	AdvancedSecure: "advanced-secure",
} as const;
export type PermissionMode = (typeof PermissionMode)[keyof typeof PermissionMode];

export const DEFAULT_MODE: PermissionMode = PermissionMode.Default;

/** Weakest → strictest. Used by the untrusted-project tighten-only merge. */
export const MODE_ORDER: readonly PermissionMode[] = [PermissionMode.Yolo, PermissionMode.Default, PermissionMode.AdvancedSecure];

/** Anything that is not one of the known modes resolves to the default. */
export function normalizeMode(value: unknown): PermissionMode {
	return value === PermissionMode.AdvancedSecure || value === PermissionMode.Yolo ? value : DEFAULT_MODE;
}

export function modeLabel(mode: PermissionMode): string {
	if (mode === PermissionMode.AdvancedSecure) return "Advanced Secure";
	if (mode === PermissionMode.Yolo) return "YOLO";
	return "Default";
}
