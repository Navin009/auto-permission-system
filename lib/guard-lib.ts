/**
 * Compatibility barrel. The implementation moved to `src/core/`.
 * Prefer importing from `../src/core/index.ts`; this re-export keeps the pi
 * entrypoints resolving `./lib/guard-lib` while the split lands.
 */
export * from "../src/core/policy/defaults";
export * from "../src/core/policy/files";
export * from "../src/core/policy/patterns";
export * from "../src/core/policy/classify";
export * from "../src/core/policy/fence";
export * from "../src/core/grep-filter";
