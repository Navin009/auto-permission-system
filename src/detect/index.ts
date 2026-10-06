/**
 * Vendored detection cores (ADR-018), from the `read-sensitive-detection`
 * project. Pure logic only — the CLIs and benchmarks are not carried over.
 *
 *  - `filename-gate`           Layer 0 name prior for file reads
 *  - `sensitive-file-scanner`  content scanner + redaction for file reads
 *  - `mcp-gate`                MCP tool-call risk classification
 *  - `tool-output-scanner`     tool/command/file output scanner + redaction
 *
 * Every core returns `decision: "allow" | "ask"` with a risk score; the guard
 * escalates to the shared ask flow, and redacts output before it reaches the
 * model.
 */
export * from "./filename-gate";
export * from "./sensitive-file-scanner";
export * from "./mcp-gate";
export * from "./tool-output-scanner";
