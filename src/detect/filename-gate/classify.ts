/**
 * Layer 0: filename classifier for the read gate.
 *
 * Pure string work, no filesystem access. Decides whether a read
 * request is even a candidate for scanning, and how risky the name
 * itself is.
 */

import path from "node:path";
import {
  CONFIG_EXTENSIONS,
  CONFIG_NAME_REGEXES,
  KEY_EXTENSIONS,
  NAME_PHRASES,
  NAME_TOKENS,
  SOURCE_EXACT_TOKENS,
  SOURCE_EXTENSIONS,
  STRONG_NAME_REGEXES,
  STRONG_PATH_REGEXES,
  STRONG_STEMS,
  WEAK_NAME_REGEXES,
} from "./patterns";
import { RISK_SCORES, type NameRisk, type NameVerdict } from "./types";

function tokensOf(value: string): Set<string> {
  return new Set(
    value
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  );
}

function isExactSourceKeyword(stem: string, tokens: Set<string>): boolean {
  const lower = stem.toLowerCase();

  if (NAME_PHRASES.includes(lower)) {
    return true;
  }

  if (tokens.size !== 1) {
    return false;
  }

  const [only] = tokens;
  return SOURCE_EXACT_TOKENS.has(only);
}

function verdictOf(risk: Exclude<NameRisk, "none">, reason: string): NameVerdict {
  return {
    candidate: true,
    risk,
    score: RISK_SCORES[risk],
    reasons: [reason],
  };
}

const NOT_A_CANDIDATE: NameVerdict = {
  candidate: false,
  risk: "none",
  score: 0,
  reasons: [],
};

export function isSourceExtension(ext: string): boolean {
  return SOURCE_EXTENSIONS.has(ext.toLowerCase());
}

export function classifyFilename(filePath: string): NameVerdict {
  const normalized = filePath.replaceAll("\\", "/");
  const base = normalized.slice(normalized.lastIndexOf("/") + 1) || normalized;
  const lower = base.toLowerCase();
  const ext = path.extname(lower);

  for (const [pattern, reason] of STRONG_NAME_REGEXES) {
    if (pattern.test(lower)) {
      return verdictOf("strong", reason);
    }
  }

  for (const [pattern, reason] of STRONG_PATH_REGEXES) {
    if (pattern.test(normalized)) {
      return verdictOf("strong", reason);
    }
  }

  if (KEY_EXTENSIONS.has(ext)) {
    return verdictOf("strong", `key/certificate file (${ext})`);
  }

  const stem = path.basename(base, path.extname(base));

  if (STRONG_STEMS.has(stem) && !isSourceExtension(ext)) {
    return verdictOf("strong", "credential filename stem");
  }

  if (/\.(tfvars|tfstate)(\.backup)?$/.test(lower)) {
    return verdictOf("config", "terraform vars/state");
  }

  for (const [pattern, reason] of CONFIG_NAME_REGEXES) {
    if (pattern.test(lower) || pattern.test(normalized)) {
      return verdictOf("weak", reason);
    }
  }

  for (const [pattern, reason] of WEAK_NAME_REGEXES) {
    if (pattern.test(lower)) {
      return verdictOf("weak", reason);
    }
  }

  const tokens = tokensOf(stem);

  if (isSourceExtension(ext)) {
    if (isExactSourceKeyword(stem, tokens)) {
      return verdictOf("generic", "exact sensitive filename keyword");
    }

    return NOT_A_CANDIDATE;
  }
  const configLike =
    CONFIG_EXTENSIONS.has(ext) || lower.startsWith(".") || ext === "";

  if (!configLike) {
    return NOT_A_CANDIDATE;
  }

  if (NAME_PHRASES.some((phrase) => lower.includes(phrase))) {
    return verdictOf("generic", "sensitive keyword in config-like filename");
  }

  for (const token of tokens) {
    if (NAME_TOKENS.has(token)) {
      return verdictOf("generic", `sensitive filename keyword: ${token}`);
    }
  }

  return NOT_A_CANDIDATE;
}
