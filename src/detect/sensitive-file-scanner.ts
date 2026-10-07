import { promises as fs, type Stats } from "node:fs";
import path from "node:path";
import {
  classifyFilename,
  isSourceExtension,
  type NameVerdict,
} from "./filename-gate";

/**
 * File-gate scanner.
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
 *   Layer 1 (this file): bounded read -> text/binary decode -> content scan.
 *
 * All regular text files are content-scanned, not just sensitive names:
 * a hardcoded key in `app.ts` must be found even though the basename is
 * ordinary. The filename only contributes prior evidence.
 *
 * Hard limit: files larger than MAX_FILE_SIZE_BYTES (2 MiB) are never
 * loaded into memory. Files that cannot be scanned (too large, symlink,
 * unreadable, binary under a text/unknown extension) FAIL CLOSED with
 * `ask` so a skip can never silently allow an unscanned candidate.
 *
 * The scanner never returns raw secret values; previews redact the matched
 * value by span.
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

/** Hard cap. A caller may lower this but can never raise it. */
export const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

export const DEFAULT_ASK_THRESHOLD = 30;

/**
 * Files that are never text. They are allowed without reading, because
 * decoding them cannot yield meaningful secret evidence.
 */
const IGNORED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tiff",
  ".tif",
  ".avif",
  ".heic",
  ".heif",
  ".ico",
  ".svgz",
  ".pdf",
  ".zip",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".rar",
  ".7z",
  ".tar",
  ".mp3",
  ".wav",
  ".ogg",
  ".flac",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".so",
  ".dll",
  ".dylib",
  ".exe",
  ".bin",
  ".dat",
  ".o",
  ".a",
  ".class",
  ".jar",
  ".war",
  ".pyc",
  ".pyo",
  ".wasm",
  ".node",
  ".iso",
  ".img",
  ".dmg",
]);

/**
 * Base weight per content finding type. Tune these, not the detection
 * logic.
 */
const BASE_SCORES: Record<string, number> = {
  PRIVATE_KEY: 100,
  JWT: 100,
  AWS_ACCESS_KEY: 90,
  KNOWN_TOKEN: 85,
  BEARER_TOKEN: 90,
  DATABASE_CREDENTIAL: 80,
  URL_CREDENTIAL: 75,
  SECRET_ASSIGNMENT: 35,
};

/** Extra weight when an assigned value looks strongly random. */
const HIGH_ENTROPY_BONUS = 20;

/** Penalty applied to lower-confidence findings in test/fixture files. */
const TEST_CONTEXT_PENALTY = 30;

/**
 * Normalized key names that are sensitive on their own, and suffixes that
 * make a compound key sensitive (GITHUB_TOKEN, AWS_SECRET_ACCESS_KEY, ...).
 *
 * Keys are normalized by lowercasing and stripping [-_. ] so camelCase,
 * snake_case and kebab-case all match.
 */
const SENSITIVE_KEYS = new Set([
  "password",
  "passwd",
  "passphrase",
  "secret",
  "secretkey",
  "clientsecret",
  "jwtsecret",
  "webhooksecret",
  "secretaccesskey",
  "apikey",
  "accesskey",
  "accesskeyid",
  "privatekey",
  "signingkey",
  "encryptionkey",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authtoken",
  "bearertoken",
  "credential",
  "credentials",
  "authorization",
  "auth",
  "serviceaccount",
  "connectionstring",
  "databaseurl",
  "accountkey",
  "smtppassword",
  "dbpassword",
  "key",
]);

const SENSITIVE_KEY_SUFFIXES = [
  "password",
  "passwd",
  "passphrase",
  "secret",
  "secretkey",
  "clientsecret",
  "jwtsecret",
  "webhooksecret",
  "secretaccesskey",
  "apikey",
  "accesskey",
  "accesskeyid",
  "privatekey",
  "signingkey",
  "encryptionkey",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authtoken",
  "bearertoken",
  "credential",
  "credentials",
  "authorization",
  "auth",
  "accountkey",
  "smtppassword",
  "dbpassword",
];

/** Keys whose value is a password: weaker entropy/length rules apply. */
const PASSWORD_KEY_REGEX = /(?:password|passwd|passphrase)$/;

/**
 * Detect private keys. Bounded and linear.
 */
const PRIVATE_KEY_REGEX =
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY-----/i;

/**
 * Detect Bearer tokens. No trailing word-boundary, so the greedy token
 * class can never backtrack.
 */
const BEARER_REGEX = /\bBearer[ \t]+[A-Za-z0-9._~+/=-]{20,}/i;

/**
 * Detect DB connection strings with embedded credentials. All quantifiers
 * are bounded, so no catastrophic backtracking is possible.
 */
const DB_CONNECTION_REGEX =
  /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mssql|redis|rediss|amqp):\/\/[^:@\s/]{1,256}:[^@\s/]{1,256}@/i;

/**
 * Detect generic URLs with embedded credentials.
 */
const URL_CREDENTIAL_REGEX =
  /\b(?:https?|ftp|sftp|ssh):\/\/[^:@\s/]{1,256}:[^@\s/]{1,256}@/i;

/**
 * .NET / JDBC style connection strings containing a password. The `;` or
 * `&` prefix ensures a plain `.env` `PASSWORD=` line (handled by the line
 * scanner) is not double-counted as a DB credential.
 */
const CONNECTION_STRING_REGEX =
  /[;&][ \t]*(?:password|pwd|pass)\s*=\s*([^;"'&\s]{3,256})/i;

/**
 * URL query parameters carrying credentials.
 */
const URL_QUERY_CREDENTIAL_REGEX =
  /[?&](?:password|passwd|pwd|pass|access_key|api_key|apikey|token)=([^&\s"']{6,256})/i;

/**
 * Known high-confidence token formats. Every pattern is bounded or fixed
 * length so it is safe on adversarial input.
 */
interface KnownFormat {
  type: string;
  label: string;
  severity: Finding["severity"];
  score: number;
  regex: RegExp;
}

const KNOWN_SECRET_FORMATS: KnownFormat[] = [
  {
    type: "AWS_ACCESS_KEY",
    label: "AWS access key ID",
    severity: "CRITICAL",
    score: 90,
    regex:
      /\b(?:AKIA|ASIA|A3T[A-Z0-9]|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16}\b/,
  },
  {
    type: "KNOWN_TOKEN",
    label: "GitHub personal access token",
    severity: "CRITICAL",
    score: 95,
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}\b/,
  },
  {
    type: "KNOWN_TOKEN",
    label: "GitHub fine-grained token",
    severity: "CRITICAL",
    score: 95,
    regex: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/,
  },
  {
    type: "KNOWN_TOKEN",
    label: "GitLab personal access token",
    severity: "CRITICAL",
    score: 95,
    regex: /\bglpat-[A-Za-z0-9_-]{20,255}\b/,
  },
  {
    type: "KNOWN_TOKEN",
    label: "Slack token",
    severity: "CRITICAL",
    score: 90,
    regex: /\bxox[abprsc]-[A-Za-z0-9-]{10,255}\b/,
  },
  {
    type: "KNOWN_TOKEN",
    label: "Stripe live key",
    severity: "CRITICAL",
    score: 90,
    regex: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,255}\b/,
  },
  {
    type: "KNOWN_TOKEN",
    label: "SendGrid API key",
    severity: "CRITICAL",
    score: 90,
    regex: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}\b/,
  },
  {
    type: "KNOWN_TOKEN",
    label: "Google API key",
    severity: "CRITICAL",
    score: 90,
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    type: "KNOWN_TOKEN",
    label: "npm access token",
    severity: "CRITICAL",
    score: 90,
    regex: /\bnpm_[A-Za-z0-9]{36}\b/,
  },
  {
    type: "KNOWN_TOKEN",
    label: "PyPI upload token",
    severity: "CRITICAL",
    score: 90,
    regex: /\bpypi-[A-Za-z0-9_-]{50,255}\b/,
  },
  {
    type: "KNOWN_TOKEN",
    label: "Anthropic API key",
    severity: "CRITICAL",
    score: 90,
    regex: /\bsk-ant-[A-Za-z0-9_-]{32,255}\b/,
  },
  {
    type: "KNOWN_TOKEN",
    label: "OpenAI API key",
    severity: "CRITICAL",
    score: 90,
    regex: /\bsk-(?!ant-)[A-Za-z0-9_-]{32,255}\b/,
  },
  {
    type: "KNOWN_TOKEN",
    label: "Azure storage account key",
    severity: "CRITICAL",
    score: 90,
    regex: /AccountKey=[A-Za-z0-9+/=]{40,256}/,
  },
];

/**
 * Common obviously fake values.
 */
const FAKE_VALUE_REGEX =
  /^(?:xxx+|yyy+|zzz+|changeme|change-me|your[_-]?password|your[_-]?token|example|sample|dummy|test|fake|placeholder|<[^>]+>)$/i;

const COMMON_NON_SECRET_VALUES = new Set([
  "string",
  "number",
  "boolean",
  "object",
  "required",
  "optional",
  "enabled",
  "disabled",
  "default",
  "localhost",
  "undefined",
  "null",
  "true",
  "false",
  "password",
  "passwd",
  "secret",
  "token",
  "secretvalue",
  "somevalue",
  "myvalue",
]);

/**
 * Paths that usually contain fixtures rather than live secrets.
 */
const TEST_CONTEXT_REGEX =
  /(^|[/\\])(?:tests?|spec|specs|__tests__|__mocks__|fixtures?|mocks?|testdata)([/\\]|$)/i;

function isTestContext(filePath: string): boolean {
  return TEST_CONTEXT_REGEX.test(filePath.replaceAll("\\", "/"));
}

function isWordCharCode(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) || // 0-9
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x61 && code <= 0x7a) || // a-z
    code === 0x5f // _
  );
}

/**
 * Detect a JWT without a backtracking regex.
 *
 * A JWT is one token of base64url characters containing exactly three
 * dot-separated segments. The token regex is a single greedy character
 * class (linear, no trailing atom), and each token is inspected once.
 */
const TOKEN_REGEX = /[A-Za-z0-9_.-]+/g;

function isJwtToken(token: string): boolean {
  if (token.length < 34 || !token.includes("eyJ")) {
    return false;
  }

  const segments = token.split(".");

  if (segments.length !== 3) {
    return false;
  }

  // Header may be prefixed by a non-word character (e.g. "x-eyJ...").
  const headerStart = findBoundaryEyJ(segments[0]);

  if (headerStart < 0 || segments[0].length - (headerStart + 3) < 10) {
    return false;
  }

  if (segments[1].length < 10 || segments[2].length < 10) {
    return false;
  }

  return isWordCharCode(token.charCodeAt(token.length - 1));
}

function containsJwt(content: string): boolean {
  TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_REGEX.exec(content)) !== null) {
    if (isJwtToken(match[0])) {
      return true;
    }
  }

  return false;
}

function findBoundaryEyJ(segment: string): number {
  let index = segment.indexOf("eyJ");

  while (index >= 0) {
    if (index === 0 || !isWordCharCode(segment.charCodeAt(index - 1))) {
      return index;
    }

    index = segment.indexOf("eyJ", index + 1);
  }

  return -1;
}

/** Simple entropy calculation in bits per character. */
function entropy(value: string): number {
  if (!value) return 0;

  const frequencies = new Map<string, number>();

  for (const char of value) {
    frequencies.set(char, (frequencies.get(char) ?? 0) + 1);
  }

  let result = 0;

  for (const count of frequencies.values()) {
    const p = count / value.length;
    result -= p * Math.log2(p);
  }

  return result;
}

export function isPlaceholder(value: string): boolean {
  const trimmed = value.trim();

  if (FAKE_VALUE_REGEX.test(trimmed)) {
    return true;
  }

  if (COMMON_NON_SECRET_VALUES.has(trimmed.toLowerCase())) {
    return true;
  }

  // Environment / template references, not literal secrets.
  if (/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(trimmed)) {
    return true;
  }

  if (/^\{\{[^{}]+\}\}$/.test(trimmed)) {
    return true;
  }

  if (/^%[A-Za-z_][A-Za-z0-9_]*%$/.test(trimmed)) {
    return true;
  }

  if (/^(?:process\.env|import\.meta\.env|os\.environ|env)\b/.test(trimmed)) {
    return true;
  }

  // Function calls / expressions are code, not literals.
  if (/^[A-Za-z_$][\w$]*\s*\(/.test(trimmed)) {
    return true;
  }

  // Masked values.
  if (/^[*x•]+$/i.test(trimmed)) {
    return true;
  }

  return false;
}

const WEAK_KEYS = new Set(["key"]);
const WEAK_KEY_MIN_ENTROPY = 1.5;

/**
 * A value that reads as an identifier, a namespaced path, or a file path —
 * never a generated secret. Used only for the bare `key` (WEAK_KEYS): `key`
 * is also an ordinary JSON/object field name, so `"key": "subagent.network"`
 * must stay clean while `key=<random>` still counts.
 */
function looksLikeIdentifierOrPath(value: string): boolean {
  if (/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(value)) {
    return true; // dotted path / namespace, e.g. subagent.network
  }

  if (/^[\w.-]+\/[\w./-]*$/.test(value)) {
    return true; // file or slash path, e.g. entropy/length
  }

  if (/^[A-Za-z]+(?:[_-][A-Za-z]+)+$/.test(value)) {
    return true; // snake_case / kebab-case, e.g. customer_id
  }

  if (/^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/.test(value)) {
    return true; // lowerCamelCase, e.g. primaryKey
  }

  return false;
}

function looksLikeRealSecret(value: string, normalizedKey: string): boolean {
  const trimmed = value.trim();
  const isPasswordKey = PASSWORD_KEY_REGEX.test(normalizedKey);
  const isWeakKey = WEAK_KEYS.has(normalizedKey);
  const minLength = isPasswordKey ? 6 : 8;

  if (trimmed.length < minLength) {
    return false;
  }

  if (isPlaceholder(trimmed)) {
    return false;
  }

  // Code, not a literal value: template interpolation, calls, indexing,
  // member access, quoting and escapes are code syntax (`const key = \`${a}:${b}\``).
  if (/[(){}[\]<>]|=>|`|\\/.test(trimmed)) {
    return false;
  }

  // Avoid flagging human-readable code phrases.
  if (/^[a-zA-Z]+(?:\s+[a-zA-Z]+){2,}$/.test(trimmed)) {
    return false;
  }

  // A generated secret never contains whitespace. Passphrases may, so this
  // excludes the password keys ("my secret phrase") only.
  if (!isPasswordKey && /\s/.test(trimmed)) {
    return false;
  }

  // Purely alphabetic identifiers (generateToken, mySecretValue) are code.
  if (
    !isPasswordKey &&
    !isWeakKey &&
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(trimmed) &&
    entropy(trimmed) < 4.0
  ) {
    return false;
  }

  const e = entropy(trimmed);

  if (isWeakKey) {
    // `key` is also an everyday field name; only a value that does not read
    // as an identifier or a path counts as a secret.
    if (looksLikeIdentifierOrPath(trimmed)) {
      return false;
    }

    return e >= WEAK_KEY_MIN_ENTROPY;
  }

  const threshold = isPasswordKey ? 2.0 : 3.0;

  return e >= threshold;
}

function getSeverity(findingType: string): Finding["severity"] {
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
 * Build a preview that redacts the exact value span. The old quote-based
 * masking leaked unquoted values from .env/YAML files.
 */
function redactValuePreview(
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

export interface RedactedText {
  text: string;
  redactions: number;
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

/**
 * Compute the risk score for a set of findings.
 *
 * The strongest finding counts in full; weaker findings count at 25% so
 * several weak hints cannot add up to the weight of a real credential.
 */
function scoreFindings(findings: Finding[]): number {
  if (findings.length === 0) {
    return 0;
  }

  const sorted = [...findings].sort((a, b) => b.score - a.score);
  const total =
    sorted[0].score +
    sorted.slice(1).reduce((sum, finding) => sum + finding.score, 0) * 0.25;

  return Math.min(100, Math.max(0, Math.round(total)));
}

function contentFinding(
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

function filenameFinding(verdict: NameVerdict, fileName: string): Finding {
  return {
    type: "SENSITIVE_FILENAME",
    severity: getSeverity("SENSITIVE_FILENAME"),
    preview: `${fileName} (${verdict.reasons.join("; ")})`,
    score: verdict.score,
  };
}

function decide(riskScore: number, askThreshold: number): ReadDecision {
  return riskScore >= askThreshold ? "ask" : "allow";
}

/**
 * Build a SKIP result. A skipped file that could contain secrets fails
 * closed: `ask` regardless of the filename score.
 */
function skipResult(args: {
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

interface DecodedText {
  text: string;
  encoding: string;
}

function decodeUtf16(buffer: Buffer, endian: "le" | "be"): string {
  const usableLength = buffer.length - (buffer.length % 2);
  const copy = Buffer.from(buffer.subarray(0, usableLength));

  if (endian === "be") {
    copy.swap16();
  }

  return copy.toString("utf16le");
}

/**
 * Reject content that is not plausibly text. Control characters and
 * Unicode replacement characters are strong binary indicators.
 */
function finalizeText(text: string, encoding: string): DecodedText | null {
  const sampleLength = Math.min(text.length, 8192);

  if (sampleLength === 0) {
    return { text, encoding };
  }

  let suspicious = 0;
  let replacements = 0;

  for (let i = 0; i < sampleLength; i++) {
    const code = text.charCodeAt(i);

    if (code === 0xfffd) {
      replacements++;
    } else if (
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      code === 0x7f
    ) {
      suspicious++;
    }
  }

  if (
    replacements / sampleLength > 0.01 ||
    suspicious / sampleLength > 0.1
  ) {
    return null;
  }

  return { text, encoding };
}

/**
 * Decode a buffer only if it is text. Handles UTF-8, UTF-8 BOM and
 * UTF-16 (BOM or alternating-NUL heuristic). Returns null for binary.
 */
function decodeTextBuffer(buffer: Buffer): DecodedText | null {
  if (buffer.length === 0) {
    return { text: "", encoding: "utf8" };
  }

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return finalizeText(buffer.subarray(3).toString("utf8"), "utf8");
  }

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return finalizeText(decodeUtf16(buffer.subarray(2), "le"), "utf16le");
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return finalizeText(decodeUtf16(buffer.subarray(2), "be"), "utf16be");
  }

  const probe = buffer.subarray(0, Math.min(buffer.length, 4096));
  let nulls = 0;
  let evenNulls = 0;
  let oddNulls = 0;

  for (let i = 0; i < probe.length; i++) {
    if (probe[i] === 0) {
      nulls++;
      if (i % 2 === 0) {
        evenNulls++;
      } else {
        oddNulls++;
      }
    }
  }

  if (nulls > 0) {
    if (nulls / probe.length > 0.25) {
      if (oddNulls > 0 && oddNulls >= evenNulls * 3) {
        return finalizeText(decodeUtf16(buffer, "le"), "utf16le");
      }

      if (evenNulls > 0 && evenNulls >= oddNulls * 3) {
        return finalizeText(decodeUtf16(buffer, "be"), "utf16be");
      }
    }

    return null;
  }

  return finalizeText(buffer.toString("utf8"), "utf8");
}

/**
 * Read at most `maxBytes + 1` bytes so an oversized file is detected
 * without loading it into memory.
 */
async function readFileCapped(filePath: string, maxBytes: number): Promise<Buffer> {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  const handle = await fs.open(filePath, flags);

  try {
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let offset = 0;

    while (offset <= maxBytes) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        maxBytes + 1 - offset,
        offset
      );

      if (bytesRead === 0) {
        break;
      }

      offset += bytesRead;
    }

    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

/**
 * Scan whole content for detectors that are not line-oriented.
 */
function contentFindings(content: string): Finding[] {
  const findings: Finding[] = [];

  if (PRIVATE_KEY_REGEX.test(content)) {
    findings.push(contentFinding("PRIVATE_KEY", { preview: "Private key detected" }));
  }

  if (containsJwt(content)) {
    findings.push(contentFinding("JWT", { preview: "JWT-like token detected" }));
  }

  if (BEARER_REGEX.test(content)) {
    findings.push(contentFinding("BEARER_TOKEN", { preview: "Bearer token detected" }));
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

interface Operator {
  start: number;
  end: number;
}

function findAssignmentOperator(line: string): Operator | null {
  for (let i = 0; i < line.length; i++) {
    if (line.charCodeAt(i) !== 0x3d) {
      continue; // '='
    }

    const previous = line[i - 1];
    const next = line[i + 1];

    if (next === "=" || next === ">") {
      i += 1; // ==, === or =>
      continue;
    }

    if (previous === "=" || previous === "!" || previous === "<" || previous === ">") {
      continue;
    }

    return { start: i, end: i + 1 };
  }

  for (let i = 0; i < line.length; i++) {
    if (line[i] !== ":") {
      continue;
    }

    if (line[i + 1] === ":" || line[i - 1] === ":") {
      continue;
    }

    if (line[i + 1] === "/" && line[i + 2] === "/") {
      continue; // URL scheme
    }

    return { start: i, end: i + 1 };
  }

  return null;
}

function extractSensitiveKey(left: string): string | null {
  const tokens = left.match(/[A-Za-z0-9_$.-]+/g);

  if (!tokens) {
    return null;
  }

  // Walk right-to-left so a trailing type annotation
  // (`const apiKey: string`) is skipped, while a timestamped log prefix
  // (`... 00:00:03Z DEBUG DB_PASSWORD`) still finds the real key.
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (isSensitiveKey(normalizeKey(tokens[i]))) {
      return tokens[i];
    }
  }

  return null;
}

export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_.\s]/g, "");
}

export function isSensitiveKey(normalized: string): boolean {
  if (SENSITIVE_KEYS.has(normalized)) {
    return true;
  }

  for (const suffix of SENSITIVE_KEY_SUFFIXES) {
    if (
      normalized.length > suffix.length &&
      normalized.endsWith(suffix)
    ) {
      return true;
    }
  }

  return false;
}

interface AssignmentAnalysis {
  keyword: string;
  value: string | null;
  valueStart: number;
  valueEnd: number;
  block: boolean;
}

const BLOCK_VALUE_REGEX = /^(?:[|>][+-]?|\\)$/;

function analyzeAssignment(
  line: string,
  allowUnquoted: boolean
): AssignmentAnalysis | null {
  const operator = findAssignmentOperator(line);

  if (!operator) {
    return null;
  }

  const key = extractSensitiveKey(line.slice(0, operator.start));

  if (!key) {
    return null;
  }

  const rest = line.slice(operator.end);
  let index = 0;

  while (index < rest.length && (rest[index] === " " || rest[index] === "\t")) {
    index++;
  }

  const valueStart = operator.end + index;
  const tail = rest.slice(index).trim();
  const isBlock = tail === "" || BLOCK_VALUE_REGEX.test(tail);
  const quote = rest[index];

  if (quote === '"' || quote === "'" || quote === "`") {
    let end = index + 1;

    while (end < rest.length) {
      if (rest[end] === "\\") {
        end += 2;
        continue;
      }

      if (rest[end] === quote) {
        break;
      }

      end++;
    }

    if (end >= rest.length) {
      return {
        keyword: key,
        value: null,
        valueStart,
        valueEnd: valueStart,
        block: false,
      };
    }

    return {
      keyword: key,
      value: rest.slice(index + 1, end),
      valueStart: valueStart + 1,
      valueEnd: operator.end + end,
      block: false,
    };
  }

  if (!allowUnquoted || isBlock) {
    return {
      keyword: key,
      value: null,
      valueStart,
      valueEnd: valueStart,
      block: isBlock,
    };
  }

  let end = index;

  while (end < rest.length && !/[\s"'#;,)\]}]/.test(rest[end])) {
    end++;
  }

  if (end === index) {
    return {
      keyword: key,
      value: null,
      valueStart,
      valueEnd: valueStart,
      block: false,
    };
  }

  return {
    keyword: key,
    value: rest.slice(index, end),
    valueStart,
    valueEnd: valueStart + (end - index),
    block: false,
  };
}

function leadingIndent(line: string): number {
  let count = 0;

  while (count < line.length && (line[count] === " " || line[count] === "\t")) {
    count++;
  }

  return count;
}

interface ContinuationValue {
  value: string;
  previewLine: string;
  valueStart: number;
  valueEnd: number;
  line: number;
}

/**
 * Bounded lookahead for values on the next line:
 *
 *   PASSWORD=
 *   <value>
 *
 *   password: >
 *     <value>
 */
function findContinuationValue(
  lines: string[],
  index: number
): ContinuationValue | null {
  const baseIndent = leadingIndent(lines[index]);
  const limit = Math.min(lines.length, index + 4);

  for (let i = index + 1; i < limit; i++) {
    const candidate = lines[i];

    if (candidate.trim() === "") {
      continue;
    }

    if (leadingIndent(candidate) < baseIndent) {
      return null;
    }

    const trimmed = candidate.trim();

    if (trimmed.startsWith("- ")) {
      return null;
    }

    if (/^[A-Za-z0-9_.-]+\s*[:=]/.test(trimmed)) {
      return null;
    }

    if (trimmed.length < 4) {
      return null;
    }

    const start = candidate.indexOf(trimmed);

    return {
      value: trimmed,
      previewLine: candidate,
      valueStart: start,
      valueEnd: start + trimmed.length,
      line: i + 1,
    };
  }

  return null;
}

/**
 * Extensions / names where an unquoted value is a real literal (shell,
 * Dockerfile, HCL, SQL, env/config). In code files such as .ts/.py/.go an
 * unquoted value is usually an expression (`generateToken()`), so it is
 * ignored.
 */
function allowsUnquotedAssignment(fileName: string, extension: string): boolean {
  const lower = fileName.toLowerCase();

  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) {
    return true;
  }

  const unquotedExtensions = new Set([
    ".env",
    ".sh",
    ".bash",
    ".zsh",
    ".ksh",
    ".fish",
    ".tf",
    ".tfvars",
    ".hcl",
    ".sql",
    ".ini",
    ".properties",
    ".conf",
    ".cfg",
    ".cnf",
    ".config",
    ".toml",
    ".yaml",
    ".yml",
    ".json",
    ".json5",
  ]);

  if (unquotedExtensions.has(extension)) {
    return true;
  }

  return !isSourceExtension(extension);
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

/**
 * Scan a plain-text blob with the shared detection core. Used by the file
 * scanner and by the tool-output scanner.
 */
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
