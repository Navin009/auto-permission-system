/**
 * Tool-OUTPUT permission gate (vendored core, ADR-018). Public surface:
 * the scan result/input types, the limit constants, and the four
 * entrypoints (generic output, command stdout/stderr, API response, MCP
 * tool result).
 */
export * from "./types";
export {
  TOOL_OUTPUT_DEFAULT_MAX_BYTES,
  TOOL_OUTPUT_HARD_MAX_BYTES,
  TOOL_OUTPUT_DEFAULT_ASK_THRESHOLD,
  TOOL_OUTPUT_MAX_DEPTH,
  TOOL_OUTPUT_MAX_NODES,
} from "./constants";
export {
  scanToolOutput,
  scanCommandOutput,
  scanApiResponse,
  scanMcpToolResult,
} from "./evaluate";
