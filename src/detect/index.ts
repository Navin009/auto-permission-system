/**
 * Vendored detection cores (ADR-018) from the `read-sensitive-detection`
 * project — pure logic only. Each returns `decision: "allow" | "ask"` with a
 * risk score.
 *
 * Layout: one folder per core, each with an `index.ts` that defines its
 * public surface. Importers should use this barrel, not the folders.
 */
export * from "./filename-gate/index";
export * from "./sensitive-file-scanner/index";
export * from "./mcp-gate/index";
export * from "./tool-output-scanner/index";
