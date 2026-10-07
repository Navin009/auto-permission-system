/**
 * Output walk + leaf scanning.
 *
 * The walk produces a redacted clone: detected leaves become
 * `***REDACTED***`; safe leaves are preserved. Detection reuses the
 * file-scanner core and adds one bounded base64 decode pass, JSON-in-
 * string recursion for double-encoded results, and sensitive JSON KEY
 * detection.
 */

import {
  isPlaceholder,
  isSensitiveKey,
  normalizeKey,
  scanTextContent,
} from "../sensitive-file-scanner/index";
import type { Finding } from "../sensitive-file-scanner/index";
import {
  BASE64_BLOB_REGEX,
  MAX_BASE64_DECODED,
  MAX_LEAF_BYTES,
  TOOL_OUTPUT_MAX_DEPTH,
  TOOL_OUTPUT_MAX_NODES,
} from "./constants";
import type {
  ToolOutputFinding,
  ToolOutputValue,
  WalkState,
} from "./types";

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

function labelFor(type: string): string {
  return TYPE_LABELS[type] ?? type.toLowerCase().replaceAll("_", " ");
}

function severityFor(score: number): Finding["severity"] {
  if (score >= 80) return "CRITICAL";
  if (score >= 40) return "HIGH";
  if (score >= 15) return "MEDIUM";
  return "LOW";
}

export function addFinding(state: WalkState, finding: ToolOutputFinding): void {
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

export function aggregateScore(findings: ToolOutputFinding[]): number {
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
export function scanLeaf(
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
 * Walk the output and produce a redacted clone.
 */
export function walk(
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
