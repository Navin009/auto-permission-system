/**
 * Shared scanner types. Kept separate so detectors, scoring, and the
 * file/read entrypoints can depend on the contract without pulling in
 * an implementation.
 */

export type ScanStatus = "ALLOW" | "ALERT" | "SKIP";

/** The only two states the read gate exposes. */
export type ReadDecision = "allow" | "ask";

export interface ScanInput {
  filePath: string;
  fileName?: string;
  maxSizeBytes?: number;
  /**
   * riskScore at (or above) which the gate asks for permission.
   * Lower = more conservative. Default 30.
   */
  askThreshold?: number;
}

export interface Finding {
  type: string;
  keyword?: string;
  line?: number;
  preview?: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  /** Weight this finding contributed to the final risk score. */
  score: number;
}

export interface ScanResult {
  /** The read-gate decision. */
  decision: ReadDecision;
  /** Accumulated risk score (0-100). */
  riskScore: number;
  /** Threshold used to make the decision. */
  askThreshold: number;
  status: ScanStatus;
  filePath: string;
  fileName: string;
  sizeBytes: number;
  findings: Finding[];
  reason?: string;
  /** Text encoding used for a scanned file, when known. */
  encoding?: string;
}

export interface RedactedText {
  text: string;
  redactions: number;
}

export interface TextScanOptions {
  /** Allow unquoted `key=value` literals (tool output, .env-style). Default true. */
  allowUnquoted?: boolean;
  /** Apply the fixture/test penalty to low-confidence findings. Default false. */
  testContext?: boolean;
  /**
   * Stop line analysis after this many findings. The output gate only needs
   * enough evidence to decide, so it caps this to avoid building thousands
   * of findings on secret-dense output. Default unlimited.
   */
  maxFindings?: number;
}

export interface TextScanResult {
  findings: Finding[];
  riskScore: number;
}
