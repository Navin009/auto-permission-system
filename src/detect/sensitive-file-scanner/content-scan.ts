/**
 * Content scanning core.
 *
 * Scans a plain-text blob with the shared detection core: whole-content
 * detectors (known token formats, JWT, private keys, bearer tokens,
 * DB/URL credentials) plus line-oriented sensitive-key assignment
 * detection. Used by the file scanner and by the tool-output scanner.
 */

import { analyzeAssignment, findContinuationValue } from "./assignment";
import {
  BASE_SCORES,
  HIGH_ENTROPY_BONUS,
  TEST_CONTEXT_PENALTY,
} from "./constants";
import { entropy } from "./entropy";
import { containsJwt } from "./jwt";
import { normalizeKey } from "./keys";
import {
  BEARER_REGEX,
  CONNECTION_STRING_REGEX,
  DB_CONNECTION_REGEX,
  KNOWN_SECRET_FORMATS,
  PRIVATE_KEY_REGEX,
  URL_CREDENTIAL_REGEX,
  URL_QUERY_CREDENTIAL_REGEX,
} from "./patterns";
import { redactValuePreview } from "./redaction";
import { contentFinding, getSeverity, scoreFindings } from "./scoring";
import type { Finding, TextScanOptions, TextScanResult } from "./types";
import { isPlaceholder, looksLikeRealSecret } from "./value-analysis";

/**
 * Scan whole content for detectors that are not line-oriented.
 */
function contentFindings(content: string): Finding[] {
  const findings: Finding[] = [];

  if (PRIVATE_KEY_REGEX.test(content)) {
    findings.push(
      contentFinding("PRIVATE_KEY", { preview: "Private key detected" })
    );
  }

  if (containsJwt(content)) {
    findings.push(contentFinding("JWT", { preview: "JWT-like token detected" }));
  }

  if (BEARER_REGEX.test(content)) {
    findings.push(
      contentFinding("BEARER_TOKEN", { preview: "Bearer token detected" })
    );
  }

  if (DB_CONNECTION_REGEX.test(content)) {
    findings.push(
      contentFinding("DATABASE_CREDENTIAL", {
        preview: "Database connection string contains credentials",
      })
    );
  }

  if (URL_CREDENTIAL_REGEX.test(content)) {
    findings.push(
      contentFinding("URL_CREDENTIAL", {
        preview: "URL contains embedded credentials",
      })
    );
  }

  const connection = CONNECTION_STRING_REGEX.exec(content);

  if (connection && !isPlaceholder(connection[1])) {
    findings.push(
      contentFinding("DATABASE_CREDENTIAL", {
        preview: "Connection string contains a password",
      })
    );
  }

  const queryCredential = URL_QUERY_CREDENTIAL_REGEX.exec(content);

  if (queryCredential && !isPlaceholder(queryCredential[1])) {
    findings.push(
      contentFinding("URL_CREDENTIAL", {
        preview: "URL query parameter contains a credential",
      })
    );
  }

  for (const format of KNOWN_SECRET_FORMATS) {
    if (format.regex.test(content)) {
      findings.push({
        type: format.type,
        severity: format.severity,
        score: format.score,
        preview: format.label,
      });
    }
  }

  return findings;
}

export function scanTextContent(
  content: string,
  options: TextScanOptions = {}
): TextScanResult {
  const allowUnquoted = options.allowUnquoted ?? true;
  const testContext = options.testContext ?? false;
  const maxFindings = options.maxFindings ?? Number.POSITIVE_INFINITY;
  const lines = content.split(/\r?\n/);
  const findings: Finding[] = contentFindings(content);

  for (let i = 0; i < lines.length; i++) {
    if (findings.length >= maxFindings) {
      break;
    }

    const line = lines[i];
    const hit = analyzeAssignment(line, allowUnquoted);

    if (!hit) {
      continue;
    }

    let value = hit.value;
    let previewLine = line;
    let valueStart = hit.valueStart;
    let valueEnd = hit.valueEnd;
    let lineNumber = i + 1;

    if (value === null) {
      if (!hit.block) {
        continue;
      }

      const continuation = findContinuationValue(lines, i);

      if (!continuation) {
        continue;
      }

      value = continuation.value;
      previewLine = continuation.previewLine;
      valueStart = continuation.valueStart;
      valueEnd = continuation.valueEnd;
      lineNumber = continuation.line;
    }

    if (value.length === 0) {
      continue;
    }

    const normalized = normalizeKey(hit.keyword);

    if (!looksLikeRealSecret(value, normalized)) {
      continue;
    }

    let score = BASE_SCORES.SECRET_ASSIGNMENT;

    if (entropy(value) >= 4.0) {
      // A strongly random literal asks regardless of context: test/mock
      // files can still contain real leaked credentials.
      score += HIGH_ENTROPY_BONUS;
    } else if (testContext) {
      // Only discount lower-confidence candidates in fixture paths.
      score -= TEST_CONTEXT_PENALTY;
    }

    findings.push({
      type: "SECRET_ASSIGNMENT",
      keyword: hit.keyword,
      line: lineNumber,
      severity: getSeverity("SECRET_ASSIGNMENT"),
      preview: redactValuePreview(previewLine, valueStart, valueEnd),
      score,
    });
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

  return {
    findings: uniqueFindings,
    riskScore: scoreFindings(uniqueFindings),
  };
}
