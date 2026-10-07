/**
 * Output-gate entrypoint.
 *
 * Detection reuses the file-scanner core (known token formats, JWT,
 * private keys, bearer tokens, DB/URL credentials, keyword assignments,
 * entropy) and adds base64 blob decoding plus deep redaction so an
 * approved output can be forwarded safely.
 *
 * Every result reports `limitBytes`, `scannedBytes`, and `totalBytes`.
 */

import { redactText } from "../sensitive-file-scanner/index";
import { TOOL_OUTPUT_DEFAULT_ASK_THRESHOLD } from "./constants";
import { addFinding, aggregateScore, scanLeaf, walk } from "./scan";
import { clampLimit, estimateSize } from "./size";
import type {
  ToolOutputReason,
  ToolOutputScanInput,
  ToolOutputScanOptions,
  ToolOutputScanResult,
  ToolOutputValue,
  WalkState,
} from "./types";

export function scanToolOutput(
  input: ToolOutputScanInput
): ToolOutputScanResult {
  const limitBytes = clampLimit(input.maxBytes);
  const askThreshold = input.askThreshold ?? TOOL_OUTPUT_DEFAULT_ASK_THRESHOLD;
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
