/**
 * MCP tool-call permission gate (vendored core, ADR-018). Public surface:
 * the gate contract types, the threshold constants, and evaluateMcpCall.
 */
export * from "./types";
export {
  MCP_DEFAULT_ASK_THRESHOLD,
  MCP_MAX_DEPTH,
  MCP_MAX_NODES,
  MCP_OPAQUE_TOOL_SCORE,
  MCP_UNKNOWN_BASE_SCORE,
} from "./constants";
export { evaluateMcpCall } from "./evaluate";
