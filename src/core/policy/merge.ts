/**
 * Policy layering. One place defines how a higher-priority layer combines with
 * a lower one, so Layer 1 and Layer 2 cannot drift.
 *
 * Precedence: shipped default < global < project. `overlayPolicy` is the
 * "authoritative" merge (array/keys present in `top` replace the base) used for
 * the global file and for a trusted project. `applyUntrustedProject` (see
 * trust.ts) is the tighten-only merge for an untrusted project.
 */

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Overlay `top` onto `base`. Object keys merge shallowly; `overrides` is
 * additive (its three lists concatenate); every other present key replaces the
 * base value. Absent keys keep the base, so a layer only states what it changes.
 */
export function overlayPolicy<T extends object>(base: T, top: Partial<T>): T {
	const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
	for (const [key, value] of Object.entries(top as Record<string, unknown>)) {
		if (value === undefined) continue;
		const existing = out[key];
		if (key === "overrides" && isPlainObject(value)) {
			const b = isPlainObject(existing) ? existing : {};
			out[key] = {
				allowRead: [...strings(b.allowRead), ...strings(value.allowRead)],
				allowWrite: [...strings(b.allowWrite), ...strings(value.allowWrite)],
				allowDomains: [...strings(b.allowDomains), ...strings(value.allowDomains)],
			};
		} else if (isPlainObject(value) && isPlainObject(existing)) {
			out[key] = { ...existing, ...value };
		} else {
			out[key] = value;
		}
	}
	return out as T;
}
