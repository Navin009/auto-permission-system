/**
 * Symlink-safe path canonicalization, shared by both layers (ADR-006).
 * Adapter module: filesystem access only — no pi, no policy.
 *
 * Walks up to the deepest existing ancestor and realpaths *that*, so symlinks
 * in the path prefix are followed even when the leaf (or any intermediate)
 * doesn't exist yet. Defeats the `cwd/symlink-to-ssh/anything` escape
 * regardless of whether `anything` exists.
 */

import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";

export function canonicalize(path: string, cwd: string): string {
	const absolute = isAbsolute(path) ? path : resolve(cwd, path);
	const suffix: string[] = [];
	let current = absolute;
	while (true) {
		try {
			const resolved = realpathSync(current);
			return suffix.length ? `${resolved}/${suffix.slice().reverse().join("/")}` : resolved;
		} catch {
			const parent = dirname(current);
			if (parent === current) return absolute;
			suffix.push(basename(current));
			current = parent;
		}
	}
}
