/**
 * Detector patterns and constant tables.
 *
 * Every regex here is bounded or fixed-length so it is safe on
 * adversarial input (no catastrophic backtracking).
 */

import type { Finding } from "./types";

/**
 * Detect private keys. Bounded and linear.
 */
export const PRIVATE_KEY_REGEX =
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY-----/i;

/**
 * Detect Bearer tokens. No trailing word-boundary, so the greedy token
 * class can never backtrack.
 */
export const BEARER_REGEX = /\bBearer[ \t]+[A-Za-z0-9._~+/=-]{20,}/i;

/**
 * Detect DB connection strings with embedded credentials. All quantifiers
 * are bounded, so no catastrophic backtracking is possible.
 */
export const DB_CONNECTION_REGEX =
  /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mssql|redis|rediss|amqp):\/\/[^:@\s/]{1,256}:[^@\s/]{1,256}@/i;

/**
 * Detect generic URLs with embedded credentials.
 */
export const URL_CREDENTIAL_REGEX =
  /\b(?:https?|ftp|sftp|ssh):\/\/[^:@\s/]{1,256}:[^@\s/]{1,256}@/i;

/**
 * .NET / JDBC style connection strings containing a password. The `;` or
 * `&` prefix ensures a plain `.env` `PASSWORD=` line (handled by the line
 * scanner) is not double-counted as a DB credential.
 */
export const CONNECTION_STRING_REGEX =
  /[;&][ \t]*(?:password|pwd|pass)\s*=\s*([^;"'&\s]{3,256})/i;

/**
 * URL query parameters carrying credentials.
 */
export const URL_QUERY_CREDENTIAL_REGEX =
  /[?&](?:password|passwd|pwd|pass|access_key|api_key|apikey|token)=([^&\s"']{6,256})/i;

/**
 * Known high-confidence token formats. Every pattern is bounded or fixed
 * length so it is safe on adversarial input.
 */
export interface KnownFormat {
  type: string;
  label: string;
  severity: Finding["severity"];
  score: number;
  regex: RegExp;
}

export const KNOWN_SECRET_FORMATS: KnownFormat[] = [
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
export const FAKE_VALUE_REGEX =
  /^(?:xxx+|yyy+|zzz+|changeme|change-me|your[_-]?password|your[_-]?token|example|sample|dummy|test|fake|placeholder|<[^>]+>)$/i;

export const COMMON_NON_SECRET_VALUES = new Set([
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
export const TEST_CONTEXT_REGEX =
  /(^|[/\\])(?:tests?|spec|specs|__tests__|__mocks__|fixtures?|mocks?|testdata)([/\\]|$)/i;

export function isTestContext(filePath: string): boolean {
  return TEST_CONTEXT_REGEX.test(filePath.replaceAll("\\", "/"));
}
