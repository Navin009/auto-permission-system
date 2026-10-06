import {
  isPlaceholder,
  isSensitiveKey,
  normalizeKey,
  redactText,
  scanTextContent,
  type Finding,
} from "./sensitive-file-scanner";

/**
 * Tool-OUTPUT permission gate (response side).
 *
 * Specialized for: command stdout/stderr, API response bodies, and MCP
 * tool RESULTS. The request side is intentionally a separate module
 * (`mcp-gate.ts`) with its own classifier; this module never inspects a
 * tool request.
 *
 * Purpose: decide whether the output may be sent to the model:
 *
 *   "allow" -> forward directly
 *   "ask"   -> ask the user before forwarding
 *
 * Detection reuses the file-scanner core (known token formats, JWT,
 * private keys, bearer tokens, DB/URL credentials, keyword assignments,
 * entropy) and adds:
 *
 *   - sensitive JSON KEY detection (`{"access_token": "..."}`) even when
 *     the value is short or low entropy,
 *   - one bounded base64 decode pass over blob-like substrings,
 *   - JSON-in-string recursion for double-encoded results,
 *   - deep redaction so an approved output can be forwarded safely.
 *
 * SIZE POLICY (performance + security):
 *   - Default scan limit: 64 KiB. Hard ceiling: 256 KiB.
 *   - The size is measured first and stops as soon as the limit is
 *     exceeded, so an oversized output costs O(limit), not O(output).
 *   - An output above the limit is SKIPPED entirely: no detectors run,
 *     and the result is "ask" (`OUTPUT_TOO_LARGE`). This keeps multi-tool
 *     loops fast while never silently forwarding unverified output.
 *
 * Every result reports `limitBytes`, `scannedBytes`, and `totalBytes`.
 */

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

/** 64 KiB: ~10–25 ms per scan, safe for many tool calls per turn. */
export const TOOL_OUTPUT_DEFAULT_MAX_BYTES = 64 * 1024;
/** 256 KiB: opt-in ceiling; larger outputs are skipped (fail closed). */
export const TOOL_OUTPUT_HARD_MAX_BYTES = 256 * 1024;
export const TOOL_OUTPUT_DEFAULT_ASK_THRESHOLD = 30;
export const TOOL_OUTPUT_MAX_DEPTH = 8;
export const TOOL_OUTPUT_MAX_NODES = 2000;

const MAX_LEAF_BYTES = 32 * 1024;
const MAX_BASE64_DECODED = 64 * 1024;
const BASE64_BLOB_REGEX = /[A-Za-z0-9+/]{32,}={0,2}/g;

const TYPE_LABELS: Record<string, string> = {
  PRIVATE_KEY: "private key",
  JWT: "JWT",
  BEARER_TOKEN: "bearer token",
  AWS_ACCESS_KEY: "AWS access key",
  KNOWN_TOKEN: "known API token",
  DATABASE_CREDENTIAL: "database credential",
  URL_CREDENTIAL: "URL credential",
  SECRET_ASSIGNMENT: "secret assignment",
  SENSITIVE_FIELD: "sensitive field",
  OUTPUT_TOO_LARGE: "output too large",
  TRUNCATED_OUTPUT: "truncated output",
};

interface WalkState {
  findings: ToolOutputFinding[];
  nodes: number;
  bytes: number;
  maxBytes: number;
  truncated: boolean;
  decodedBytes: number;
  seen: WeakSet<object>;
}

interface SizeEstimate {
  bytes: number;
  exceeded: boolean;
  exact: boolean;
}

function labelFor(type: string): string {
  return TYPE_LABELS[type] ?? type.toLowerCase().replaceAll("_", " ");
}

function severityFor(score: number): Finding["severity"] {
  if (score >= 80) return "CRITICAL";
  if (score >= 40) return "HIGH";
  if (score >= 15) return "MEDIUM";
  return "LOW";
}

function clampLimit(value: number | undefined): number {
  const requested = value ?? TOOL_OUTPUT_DEFAULT_MAX_BYTES;
  return Math.min(Math.max(1, requested), TOOL_OUTPUT_HARD_MAX_BYTES);
}

/**
 * Measure the output size without materializing it, stopping as soon as
 * the limit is exceeded. For a plain string the size is exact; for a
 * structure it is an approximate serialized size.
 */
function estimateSize(output: unknown, limit: number): SizeEstimate {
  if (typeof output === "string") {
    const bytes = Buffer.byteLength(output);
    return { bytes, exceeded: bytes > limit, exact: true };
  }

  let bytes = 0;
  let nodes = 0;
  const stack: unknown[] = [output];

  while (stack.length > 0) {
    if (nodes++ > TOOL_OUTPUT_MAX_NODES) {
      return { bytes, exceeded: true, exact: false };
    }

    const current = stack.pop();

    if (typeof current === "string") {
      bytes += current.length + 2;
    } else if (typeof current === "number") {
      bytes += 8;
    } else if (typeof current === "boolean") {
      bytes += 5;
    } else if (current === null || current === undefined) {
      bytes += 4;
    } else if (Array.isArray(current)) {
      bytes += 2;

      for (let i = 0; i < current.length; i++) {
        stack.push(current[i]);
        bytes += 4;

        if (bytes > limit || stack.length > TOOL_OUTPUT_MAX_NODES) {
          return { bytes, exceeded: true, exact: false };
        }
      }
    } else if (typeof current === "object") {
      bytes += 2;

      for (const [key, child] of Object.entries(
        current as Record<string, unknown>
      )) {
        bytes += key.length + 4;
        stack.push(child);

        if (bytes > limit || stack.length > TOOL_OUTPUT_MAX_NODES) {
          return { bytes, exceeded: true, exact: false };
        }
      }
    }

    if (bytes > limit) {
      return { bytes, exceeded: true, exact: false };
    }
  }

  return { bytes, exceeded: false, exact: false };
}

function addFinding(state: WalkState, finding: ToolOutputFinding): void {
  const key = `${finding.type}:${finding.path ?? ""}`;

  if (
    state.findings.some(
      (existing) => `${existing.type}:${existing.path ?? ""}` === key
    )
  ) {
    return;
  }

  state.findings.push(finding);
}

function aggregateScore(findings: ToolOutputFinding[]): number {
  if (findings.length === 0) {
    return 0;
  }

  const sorted = [...findings].sort((a, b) => b.score - a.score);
  const total =
    sorted[0].score +
    sorted.slice(1).reduce((sum, finding) => sum + finding.score, 0) * 0.25;

  return Math.min(100, Math.max(0, Math.round(total)));
}

/**
 * Scan one string leaf. Returns the number of findings plus a version of
 * the leaf with base64 blobs redacted.
 */
function scanLeaf(
  value: string,
  path: string,
  state: WalkState
): { count: number; processed: string } {
  const before = state.findings.length;
  let processed = value;

  if (value.length >= 32) {
    processed = value.replace(BASE64_BLOB_REGEX, (blob) => {
      if (state.decodedBytes + blob.length > MAX_BASE64_DECODED) {
        state.truncated = true;
        return blob;
      }

      state.decodedBytes += blob.length;
      const decoded = Buffer.from(blob, "base64").toString("utf8");
      const decodedResult = scanTextContent(decoded, {
        allowUnquoted: true,
        maxFindings: 8,
      });

      if (decodedResult.findings.length === 0) {
        return blob;
      }

      for (const finding of decodedResult.findings) {
        addFinding(state, {
          type: `${finding.type}_BASE64`,
          label: `${labelFor(finding.type)} (base64)`,
          severity: finding.severity,
          score: finding.score,
          path,
          preview: finding.preview,
        });
      }

      return "[REDACTED:BASE64]";
    });
  }

  const result = scanTextContent(processed, {
    allowUnquoted: true,
    maxFindings: 8,
  });

  for (const finding of result.findings) {
    addFinding(state, {
      type: finding.type,
      label: labelFor(finding.type),
      severity: finding.severity,
      score: finding.score,
      path,
      preview: finding.preview,
    });
  }

  return { count: state.findings.length - before, processed };
}

/**
 * Walk the output and produce a redacted clone. Detected leaves become
 * `***REDACTED***`; safe leaves are preserved.
 */
function walk(
  value: unknown,
  path: string,
  state: WalkState,
  depth: number
): ToolOutputValue {
  state.nodes++;

  if (state.nodes > TOOL_OUTPUT_MAX_NODES || depth > TOOL_OUTPUT_MAX_DEPTH) {
    state.truncated = true;
    return "[TRUNCATED]";
  }

  if (typeof value === "string") {
    state.bytes += value.length;

    let text = value;

    if (value.length > MAX_LEAF_BYTES) {
      state.truncated = true;
      text = value.slice(0, MAX_LEAF_BYTES);
    }

    const trimmed = text.trim();

    // Double-encoded JSON: scan the nested structure, keep the string type.
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        const before = state.findings.length;
        walk(parsed, path, state, depth + 1);

        if (state.findings.length > before) {
          return "***REDACTED***";
        }
      } catch {
        // not JSON; continue with the text scan
      }
    }

    const leaf = scanLeaf(text, path, state);

    if (leaf.count > 0) {
      return "***REDACTED***";
    }

    return text.length < value.length ? `${text}...[TRUNCATED]` : value;
  }

  if (Array.isArray(value)) {
    const result: ToolOutputValue[] = [];

    for (let i = 0; i < value.length; i++) {
      result.push(walk(value[i], `${path}[${i}]`, state, depth + 1));
    }

    return result;
  }

  if (value && typeof value === "object") {
    if (state.seen.has(value)) {
      return "[CIRCULAR]";
    }

    state.seen.add(value);
    const result: Record<string, ToolOutputValue> = {};

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      const findingsBefore = state.findings.length;
      const childRedacted = walk(child, childPath, state, depth + 1);

      const valueIsSecretPrimitive =
        isSensitiveKey(normalizeKey(key)) &&
        ((typeof child === "string" &&
          child.length >= 6 &&
          !isPlaceholder(child)) ||
          (typeof child === "number" && String(child).length >= 6));

      if (valueIsSecretPrimitive) {
        addFinding(state, {
          type: "SENSITIVE_FIELD",
          label: `${key} field`,
          severity: severityFor(60),
          score: 60,
          path: childPath,
        });
      }

      result[key] =
        valueIsSecretPrimitive || state.findings.length > findingsBefore
          ? "***REDACTED***"
          : childRedacted;
    }

    return result;
  }

  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  return null;
}

export function scanToolOutput(input: ToolOutputScanInput): ToolOutputScanResult {
  const limitBytes = clampLimit(input.maxBytes);
  const askThreshold =
    input.askThreshold ?? TOOL_OUTPUT_DEFAULT_ASK_THRESHOLD;
  const estimate = estimateSize(input.output, limitBytes);

  // Fast path: oversized output is skipped, never scanned.
  if (estimate.exceeded) {
    return {
      decision: "ask",
      riskScore: 100,
      askThreshold,
      findings: [
        {
          type: "OUTPUT_TOO_LARGE",
          label: `output exceeds the ${limitBytes}-byte scan limit`,
          severity: "HIGH",
          score: 100,
        },
      ],
      reason: "OUTPUT_TOO_LARGE",
      summary:
        `Tool output is ${estimate.bytes}${estimate.exact ? "" : "+"} bytes, ` +
        `above the ${limitBytes}-byte limit; skipped without scanning.`,
      redactedOutput: undefined,
      truncated: true,
      skipped: true,
      limitBytes,
      scannedBytes: 0,
      totalBytes: estimate.bytes,
      sizeExact: estimate.exact,
    };
  }

  const state: WalkState = {
    findings: [],
    nodes: 0,
    bytes: 0,
    maxBytes: limitBytes,
    truncated: false,
    decodedBytes: 0,
    seen: new WeakSet(),
  };

  const isPlainString = typeof input.output === "string";
  let redactedOutput: ToolOutputValue | undefined;

  if (isPlainString) {
    const text = input.output as string;
    state.bytes = text.length;
    const leaf = scanLeaf(text, "output", state);

    if (input.redact !== false) {
      redactedOutput =
        leaf.count > 0 ? redactText(leaf.processed).text : leaf.processed;
    }
  } else {
    redactedOutput = walk(input.output, "output", state, 0);
  }

  if (state.truncated) {
    addFinding(state, {
      type: "TRUNCATED_OUTPUT",
      label: "output exceeded scan limits",
      severity: "HIGH",
      score: 0,
      path: "output",
    });
  }

  const riskScore = aggregateScore(state.findings);
  const decision =
    state.truncated || riskScore >= askThreshold ? "ask" : "allow";
  const reason: ToolOutputReason = state.truncated
    ? "TRUNCATED_OUTPUT"
    : riskScore >= askThreshold
      ? "SENSITIVE_OUTPUT"
      : "CLEAN_OUTPUT";

  const notable = [
    ...new Set(
      state.findings
        .filter((finding) => finding.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((finding) => finding.label)
    ),
  ];

  const sizeNote = `${state.bytes}/${limitBytes} bytes`;

  const summary =
    decision === "allow"
      ? `Tool output looks clean (${sizeNote} scanned)`
      : notable.length > 0
        ? `Tool output may contain secrets: ${notable.join(", ")} (${sizeNote} scanned)`
        : `Tool output exceeded scan limits (${sizeNote})`;

  return {
    decision,
    riskScore,
    askThreshold,
    findings: state.findings,
    reason,
    summary,
    redactedOutput: input.redact === false ? undefined : redactedOutput,
    truncated: state.truncated,
    skipped: false,
    limitBytes,
    scannedBytes: state.bytes,
    totalBytes: estimate.bytes,
    sizeExact: estimate.exact,
  };
}

/**
 * Command output convenience: stdout (+ optional stderr) through the
 * output gate with the default 256 KiB limit.
 */
export function scanCommandOutput(
  stdout: string,
  stderr = "",
  options: ToolOutputScanOptions = {}
): ToolOutputScanResult {
  return scanToolOutput({
    output: stderr ? `${stdout}\n${stderr}` : stdout,
    ...options,
  });
}

/** API response body convenience. */
export function scanApiResponse(
  body: unknown,
  options: ToolOutputScanOptions = {}
): ToolOutputScanResult {
  return scanToolOutput({ output: body, ...options });
}

/** MCP tool-result convenience (content blocks and/or structuredContent). */
export function scanMcpToolResult(
  result: unknown,
  options: ToolOutputScanOptions = {}
): ToolOutputScanResult {
  return scanToolOutput({ output: result, ...options });
}
