/**
 * Vendored detection cores (ADR-018) from the `read-sensitive-detection`
 * project — pure logic only. Each returns `decision: "allow" | "ask"` with a
 * risk score.
 */
export * from "./filename-gate";
export * from "./sensitive-file-scanner";
export * from "./mcp-gate";
export * from "./tool-output-scanner";
