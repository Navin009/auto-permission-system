import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Node resolve hook for the unit tests.
 *
 * The TypeScript sources use extensionless relative imports (what `tsc`,
 * pi's jiti loader, and the LSP all expect). Node's ESM loader does not do
 * extension guessing, so a test that imports `src/core/index.ts` would fail on
 * its `./policy/fence` re-exports. This hook retries an extensionless
 * relative specifier with `.ts` when that file exists, and is otherwise a
 * pass-through. Registered via `--import ./security/tests/ts-loader.mjs`.
 */
export async function resolve(specifier, context, nextResolve) {
	if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
		try {
			const candidate = new URL(`${specifier}.ts`, context.parentURL);
			if (existsSync(fileURLToPath(candidate))) {
				return nextResolve(`${specifier}.ts`, context);
			}
		} catch {
			/* fall through to the default resolver */
		}
	}
	return nextResolve(specifier, context);
}
