/**
 * File-gate entrypoints.
 *
 * Purpose: decide whether an agent may READ a file without asking.
 *
 * Only two outcomes matter for reading:
 *
 *   "allow" -> the agent may read the file directly
 *   "ask"   -> the agent must ask the user for permission first
 *
 * Pipeline:
 *
 *   Layer 0 (filename-gate): cheap risk prior for the path.
 *   Layer 1: bounded read -> text/binary decode -> content scan.
 *
 * All regular text files are content-scanned, not just sensitive names:
 * a hardcoded key in `app.ts` must be found even though the basename is
 * ordinary. The filename only contributes prior evidence.
 *
 * Hard limit: files larger than MAX_FILE_SIZE_BYTES (2 MiB) are never
 * loaded into memory. Files that cannot be scanned (too large, symlink,
 * unreadable, binary under a text/unknown extension) FAIL CLOSED with
 * `ask` so a skip can never silently allow an unscanned candidate.
 */

import { promises as fs, type Stats } from "node:fs";
import path from "node:path";
import { classifyFilename } from "../filename-gate/index";
import { allowsUnquotedAssignment } from "./assignment";
import {
  DEFAULT_ASK_THRESHOLD,
  IGNORED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
} from "./constants";
import { scanTextContent } from "./content-scan";
import { decodeTextBuffer, readFileCapped } from "./decoding";
import { isTestContext } from "./patterns";
import { decide, filenameFinding, scoreFindings, skipResult } from "./scoring";
import type { Finding, ReadDecision, ScanInput, ScanResult } from "./types";

export async function scanFile(input: ScanInput): Promise<ScanResult> {
  const hardCap = MAX_FILE_SIZE_BYTES;
  const requested = input.maxSizeBytes ?? hardCap;
  const maxSizeBytes = Math.min(Math.max(1, requested), hardCap);
  const askThreshold = input.askThreshold ?? DEFAULT_ASK_THRESHOLD;

  const absolutePath = path.resolve(input.filePath);
  const baseName = path.basename(absolutePath);
  const fileName = input.fileName ?? baseName;
  const extension = path.extname(baseName).toLowerCase();

  const verdict = classifyFilename(absolutePath);
  const ignoredByExtension = IGNORED_EXTENSIONS.has(extension);

  // ------------------------------------------------------------
  // Layer 0: path metadata. Never follow symlinks.
  // ------------------------------------------------------------

  let stat: Stats;

  try {
    stat = await fs.lstat(absolutePath);
  } catch {
    return skipResult({
      absolutePath,
      fileName,
      sizeBytes: 0,
      reason: "FILE_NOT_FOUND",
      verdict,
      askThreshold,
      failClosed: verdict.risk === "strong",
    });
  }

  if (stat.isSymbolicLink()) {
    return skipResult({
      absolutePath,
      fileName,
      sizeBytes: 0,
      reason: "SYMLINK",
      verdict,
      askThreshold,
      failClosed: !ignoredByExtension,
    });
  }

  if (!stat.isFile()) {
    return skipResult({
      absolutePath,
      fileName,
      sizeBytes: stat.size,
      reason: "NOT_A_FILE",
      verdict,
      askThreshold,
      failClosed: !ignoredByExtension,
    });
  }

  if (ignoredByExtension) {
    // Content is never decoded for binary extensions, so a sensitive
    // NAME must fail closed here: a cert/keystore/credential artifact
    // could otherwise be converted into a readable secret by the agent.
    return skipResult({
      absolutePath,
      fileName,
      sizeBytes: stat.size,
      reason: "BINARY_EXTENSION",
      verdict,
      askThreshold,
      failClosed: verdict.candidate,
    });
  }

  if (stat.size > maxSizeBytes) {
    return skipResult({
      absolutePath,
      fileName,
      sizeBytes: stat.size,
      reason: `FILE_TOO_LARGE_LIMIT_${maxSizeBytes}`,
      verdict,
      askThreshold,
      failClosed: true,
    });
  }

  // ------------------------------------------------------------
  // Layer 1: bounded read + text decode. Content scan for all text.
  // ------------------------------------------------------------

  let buffer: Buffer;

  try {
    buffer = await readFileCapped(absolutePath, maxSizeBytes);
  } catch {
    return skipResult({
      absolutePath,
      fileName,
      sizeBytes: stat.size,
      reason: "READ_ERROR",
      verdict,
      askThreshold,
      failClosed: true,
    });
  }

  if (buffer.length > maxSizeBytes) {
    return skipResult({
      absolutePath,
      fileName,
      sizeBytes: stat.size,
      reason: `FILE_TOO_LARGE_LIMIT_${maxSizeBytes}`,
      verdict,
      askThreshold,
      failClosed: true,
    });
  }

  const decoded = decodeTextBuffer(buffer);

  if (!decoded) {
    return skipResult({
      absolutePath,
      fileName,
      sizeBytes: stat.size,
      reason: "BINARY_FILE",
      verdict,
      askThreshold,
      failClosed: true,
    });
  }

  const textResult = scanTextContent(decoded.text, {
    allowUnquoted: allowsUnquotedAssignment(baseName, extension),
    testContext: isTestContext(absolutePath),
  });
  const findings: Finding[] = [...textResult.findings];

  /**
   * Filename evidence is included for sensitive names, even when the
   * content scan finds nothing.
   */
  if (verdict.candidate) {
    findings.push(filenameFinding(verdict, fileName));
  }

  // Remove duplicate findings (same type on the same line).
  const uniqueFindings = Array.from(
    new Map(
      findings.map((finding) => [
        `${finding.type}:${finding.line ?? 0}`,
        finding,
      ])
    ).values()
  );

  const riskScore = scoreFindings(uniqueFindings);
  const decision = decide(riskScore, askThreshold);

  const hasCritical = uniqueFindings.some(
    (finding) => finding.severity === "CRITICAL"
  );

  return {
    decision,
    riskScore,
    askThreshold,
    status: hasCritical || decision === "ask" ? "ALERT" : "ALLOW",
    filePath: absolutePath,
    fileName,
    sizeBytes: stat.size,
    findings: uniqueFindings,
    encoding: decoded.encoding,
    reason:
      decision === "ask"
        ? "SENSITIVE_INFORMATION_DETECTED"
        : "NO_SENSITIVE_INFORMATION_DETECTED",
  };
}

/**
 * Convenience wrapper for the read gate.
 */
export async function evaluateRead(input: ScanInput): Promise<{
  decision: ReadDecision;
  riskScore: number;
  findings: Finding[];
}> {
  const result = await scanFile(input);
  return {
    decision: result.decision,
    riskScore: result.riskScore,
    findings: result.findings,
  };
}
