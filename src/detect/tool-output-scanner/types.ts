/**
 * Tool-output gate contract (response side).
 *
 * Specialized for command stdout/stderr, API response bodies, and MCP
 * tool RESULTS. The request side is intentionally a separate module
 * (`mcp-gate`) with its own classifier; this module never inspects a
 * tool request.
 */

import type { Finding } from "../sensitive-file-scanner/index";

export interface ToolOutputScanInput {
  /** The content to scan: string, object, array, or MCP result shape. */
  output: unknown;
  /** Scan limit. Lowered to the caller value, clamped to the hard ceiling. */
  maxBytes?: number;
  /** Score at (or above) which the gate asks. Default 30. */
  askThreshold?: number;
  /** Produce a redacted copy of the output. Default true. */
  redact?: boolean;
}

export type ToolOutputScanOptions = Omit<ToolOutputScanInput, "output">;

export interface ToolOutputFinding {
  type: string;
  label: string;
  severity: Finding["severity"];
  score: number;
  /** JSON path to the leaf, e.g. `output.content[0].text`. */
  path?: string;
  preview?: string;
}

export type ToolOutputDecision = "allow" | "ask";

/** JSON-shaped value accepted/produced by the redaction walk. */
export type ToolOutputValue =
  | string
  | number
  | boolean
  | null
  | ToolOutputValue[]
  | { [key: string]: ToolOutputValue };

export type ToolOutputReason =
  | "CLEAN_OUTPUT"
  | "SENSITIVE_OUTPUT"
  | "TRUNCATED_OUTPUT"
  | "OUTPUT_TOO_LARGE";

export interface ToolOutputScanResult {
  decision: ToolOutputDecision;
  riskScore: number;
  askThreshold: number;
  findings: ToolOutputFinding[];
  reason: ToolOutputReason;
  summary: string;
  /** Copy of the output with detected values redacted (absent if skipped). */
  redactedOutput?: ToolOutputValue;
  /** True when limits were hit and part of the output was not scanned. */
  truncated: boolean;
  /** True when the output exceeded the limit and no detectors were run. */
  skipped: boolean;
  /** Effective scan limit in bytes. */
  limitBytes: number;
  /** Bytes actually passed through the detectors. */
  scannedBytes: number;
  /** Exact size for strings; approximate serialized size for structures. */
  totalBytes: number;
  /** Whether `totalBytes` is exact (string) or approximate (structure). */
  sizeExact: boolean;
}

/** Mutable state threaded through the walk. */
export interface WalkState {
  findings: ToolOutputFinding[];
  nodes: number;
  bytes: number;
  maxBytes: number;
  truncated: boolean;
  decodedBytes: number;
  seen: WeakSet<object>;
}

export interface SizeEstimate {
  bytes: number;
  exceeded: boolean;
  exact: boolean;
}
