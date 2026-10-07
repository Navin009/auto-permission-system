/**
 * Redaction helpers.
 *
 * The scanner never returns raw secret values: previews redact the
 * matched value by span, and `redactText` replaces detected values in a
 * text blob with markers.
 */

import { analyzeAssignment } from "./assignment";
import { isJwtToken, TOKEN_REGEX } from "./jwt";
import { normalizeKey } from "./keys";
import { KNOWN_SECRET_FORMATS } from "./patterns";
import type { RedactedText } from "./types";
import { looksLikeRealSecret } from "./value-analysis";

/**
 * Build a preview that redacts the exact value span. The old quote-based
 * masking leaked unquoted values from .env/YAML files.
 */
export function redactValuePreview(
  line: string,
  valueStart: number,
  valueEnd: number,
  maxLength = 220
): string {
  const start = Math.max(0, Math.min(valueStart, line.length));
  const end = Math.max(start, Math.min(valueEnd, line.length));
  const head = line.slice(0, Math.min(start, maxLength));

  if (start >= maxLength) {
    return head;
  }

  const redacted = "***REDACTED***";
  const remaining = maxLength - head.length - redacted.length;
  const tail = remaining > 0 ? line.slice(end, end + remaining) : "";

  return head + redacted + tail;
}

/**
 * Replace detected secret values in a text blob with redaction markers.
 * Intended for preparing tool output for the model after user approval.
 * Never guarantees completeness; callers should still gate on findings.
 */
export function redactText(content: string): RedactedText {
  let text = content;
  let redactions = 0;

  // 1. key/value assignments (covers generic secrets without a format).
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hit = analyzeAssignment(line, true);

    if (!hit || hit.value === null || hit.value.length === 0) {
      continue;
    }

    if (!looksLikeRealSecret(hit.value, normalizeKey(hit.keyword))) {
      continue;
    }

    if (hit.valueStart >= hit.valueEnd) {
      continue;
    }

    lines[i] = `${line.slice(0, hit.valueStart)}***REDACTED***${line.slice(hit.valueEnd)}`;
    redactions += 1;
  }

  text = lines.join("\n");

  // 2. JWT (linear token scan).
  text = text.replace(TOKEN_REGEX, (token) => {
    if (!isJwtToken(token)) {
      return token;
    }

    redactions += 1;
    return "[REDACTED:JWT]";
  });

  // 3. PEM private keys.
  const pemBody =
    /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[\s\S]{0,200000}?-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----/g;
  const pemMatches = text.match(pemBody);

  if (pemMatches) {
    redactions += pemMatches.length;
    text = text.replace(pemBody, "[REDACTED:PRIVATE_KEY]");
  }

  const pemBegin = /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----/g;
  const beginMatches = text.match(pemBegin);

  if (beginMatches) {
    redactions += beginMatches.length;
    text = text.replace(pemBegin, "[REDACTED:PRIVATE_KEY_BEGIN]");
  }

  // 4. Bearer tokens.
  const bearer = /\bBearer[ \t]+[A-Za-z0-9._~+/=-]{20,}/gi;
  const bearerMatches = text.match(bearer);

  if (bearerMatches) {
    redactions += bearerMatches.length;
    text = text.replace(bearer, "Bearer [REDACTED]");
  }

  // 5. URL / connection-string passwords.
  const urlCredentials =
    /(\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mssql|redis|rediss|amqp|https?|ftp|sftp|ssh):\/\/[^:@\s/]{1,256}):[^@\s/]{1,256}@/gi;

  text = text.replace(urlCredentials, (_match, prefix: string) => {
    redactions += 1;
    return `${prefix}:***REDACTED***@`;
  });

  // 6. Known token formats.
  for (const format of KNOWN_SECRET_FORMATS) {
    const flags = format.regex.flags.includes("g")
      ? format.regex.flags
      : `${format.regex.flags}g`;
    const global = new RegExp(format.regex.source, flags);
    const matches = text.match(global);

    if (!matches) {
      continue;
    }

    redactions += matches.length;
    text = text.replace(global, `[REDACTED:${format.label}]`);
  }

  return { text, redactions };
}
