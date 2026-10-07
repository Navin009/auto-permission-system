/**
 * Severity, scoring, and decision helpers shared by the content scanner
 * and the file gate.
 */

import type { NameVerdict } from "../filename-gate/index";
import { BASE_SCORES } from "./constants";
import type { Finding, ReadDecision, ScanResult } from "./types";

export function getSeverity(findingType: string): Finding["severity"] {
  if (
    findingType === "PRIVATE_KEY" ||
    findingType === "JWT" ||
    findingType === "BEARER_TOKEN" ||
    findingType === "AWS_ACCESS_KEY" ||
    findingType === "KNOWN_TOKEN"
  ) {
    return "CRITICAL";
  }

  if (
    findingType === "DATABASE_CREDENTIAL" ||
    findingType === "URL_CREDENTIAL" ||
    findingType === "SECRET_ASSIGNMENT" ||
    findingType === "SENSITIVE_FILENAME" ||
    findingType === "UNSCANNED_FILE"
  ) {
    return "HIGH";
  }

  return "MEDIUM";
}

/**
 * Compute the risk score for a set of findings.
 *
 * The strongest finding counts in full; weaker findings count at 25% so
 * several weak hints cannot add up to the weight of a real credential.
 */
export function scoreFindings(findings: Finding[]): number {
  if (findings.length === 0) {
    return 0;
  }

  const sorted = [...findings].sort((a, b) => b.score - a.score);
  const total =
    sorted[0].score +
    sorted.slice(1).reduce((sum, finding) => sum + finding.score, 0) * 0.25;

  return Math.min(100, Math.max(0, Math.round(total)));
}

export function contentFinding(
  type: string,
  extra: Partial<Finding> = {}
): Finding {
  return {
    type,
    severity: getSeverity(type),
    score: BASE_SCORES[type] ?? 0,
    ...extra,
  };
}

export function filenameFinding(
  verdict: NameVerdict,
  fileName: string
): Finding {
  return {
    type: "SENSITIVE_FILENAME",
    severity: getSeverity("SENSITIVE_FILENAME"),
    preview: `${fileName} (${verdict.reasons.join("; ")})`,
    score: verdict.score,
  };
}

export function decide(
  riskScore: number,
  askThreshold: number
): ReadDecision {
  return riskScore >= askThreshold ? "ask" : "allow";
}

/**
 * Build a SKIP result. A skipped file that could contain secrets fails
 * closed: `ask` regardless of the filename score.
 */
export function skipResult(args: {
  absolutePath: string;
  fileName: string;
  sizeBytes: number;
  reason: string;
  verdict: NameVerdict;
  askThreshold: number;
  failClosed: boolean;
}): ScanResult {
  const findings = args.verdict.candidate
    ? [filenameFinding(args.verdict, args.fileName)]
    : [];

  if (args.failClosed) {
    findings.push({
      type: "UNSCANNED_FILE",
      severity: "HIGH",
      score: 0,
      preview: args.reason,
    });
  }

  const riskScore = scoreFindings(findings);
  const decision =
    args.failClosed || riskScore >= args.askThreshold ? "ask" : "allow";

  return {
    decision,
    riskScore,
    askThreshold: args.askThreshold,
    status: "SKIP",
    filePath: args.absolutePath,
    fileName: args.fileName,
    sizeBytes: args.sizeBytes,
    findings,
    reason: args.reason,
  };
}
