/**
 * MCP tool-call gate contract.
 *
 * Given an MCP tool definition (name, title, description, inputSchema,
 * annotations) and optionally a concrete call (name, arguments), the gate
 * decides whether the agent may run it:
 *
 *   "allow" -> execute directly
 *   "ask"   -> ask the user for confirmation first
 */

export type McpDecision = "allow" | "ask";

export type McpClassification =
  | "read"
  | "additive"
  | "operational"
  | "mutating"
  | "destructive"
  | "unknown";

export type McpSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface JsonSchemaLike {
  type?: string;
  properties?: Record<string, JsonSchemaLike>;
  items?: JsonSchemaLike;
  enum?: unknown[];
  default?: unknown;
  [key: string]: unknown;
}

export interface McpToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: JsonSchemaLike;
  annotations?: McpToolAnnotations;
}

export interface McpToolCall {
  name?: string;
  arguments?: Record<string, unknown>;
}

export interface McpPolicy {
  /** Exact tool names always allowed. */
  allowTools?: string[];
  /** Exact tool names always asked. */
  askTools?: string[];
  /** Prefix matches against the tool name (case-insensitive). */
  allowPrefixes?: string[];
  /** Trust server-provided readOnlyHint enough to allow. */
  trustAnnotations?: boolean;
  /** Allow narrowly-scoped field updates without asking. Default true. */
  allowSimpleUpdates?: boolean;
  /** Score at (or above) which the gate asks. Default 30. */
  askThreshold?: number;
}

export interface McpGateInput {
  tool: McpToolDefinition;
  call?: McpToolCall;
  policy?: McpPolicy;
}

export interface McpFinding {
  type: string;
  label: string;
  severity: McpSeverity;
  score: number;
  path?: string;
}

export interface McpGateResult {
  decision: McpDecision;
  classification: McpClassification;
  riskScore: number;
  askThreshold: number;
  findings: McpFinding[];
  reason: string;
  /** One-line explanation suitable for a confirmation prompt. */
  summary: string;
}
