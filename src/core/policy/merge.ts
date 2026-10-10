/**
 * Policy layering. One place defines how a higher-priority layer combines with
 * a lower one, so Layer 1 and Layer 2 cannot drift.
 *
 * Precedence: shipped default < global < project. `overlayPolicy` is the
 * "authoritative" merge (array/keys present in `top` replace the base) used for
 * the global file and for a trusted project. `applyUntrustedProject` (see
 * trust.ts) is the tighten-only merge for an untrusted project.
 */

const isPlainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

/**
 * Overlay `top` onto `base`. Object keys merge shallowly; `overrides` is
 * additive (its three lists concatenate); every other present key replaces the
 * base value. Absent keys keep the base, so a layer only states what it changes.
 */
export function overlayPolicy<T extends object>(base: T, top: Partial<T>): T {
	const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };
	for (const [key, value] of Object.entries(top as Record<string, unknown>)) {
		if (value === undefined) continue;
		const existing = merged[key];
		if (key === "overrides" && isPlainObject(value)) {
			const baseOverrides = isPlainObject(existing) ? existing : {};
			merged[key] = {
				allowRead: [...stringList(baseOverrides.allowRead), ...stringList(value.allowRead)],
				allowWrite: [...stringList(baseOverrides.allowWrite), ...stringList(value.allowWrite)],
				allowDomains: [...stringList(baseOverrides.allowDomains), ...stringList(value.allowDomains)],
			};
		} else if (isPlainObject(value) && isPlainObject(existing)) {
			merged[key] = { ...existing, ...value };
		} else {
			merged[key] = value;
		}
	}
	return merged as T;
}
