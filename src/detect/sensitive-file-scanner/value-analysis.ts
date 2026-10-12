/**
 * Value-level heuristics: is an assigned value a placeholder, an
 * identifier/path, or a real secret?
 */

import { entropy } from "./entropy";
import { PASSWORD_KEY_REGEX } from "./keys";
import { COMMON_NON_SECRET_VALUES, FAKE_VALUE_REGEX } from "./patterns";

export function isPlaceholder(value: string): boolean {
  const trimmed = value.trim();

  if (FAKE_VALUE_REGEX.test(trimmed)) {
    return true;
  }

  if (COMMON_NON_SECRET_VALUES.has(trimmed.toLowerCase())) {
    return true;
  }

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

  if (/^[A-Za-z_$][\w$]*\s*\(/.test(trimmed)) {
    return true;
  }

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
    return true;
  }

  if (/^[\w.-]+\/[\w./-]*$/.test(value)) {
    return true;
  }

  if (/^[A-Za-z]+(?:[_-][A-Za-z]+)+$/.test(value)) {
    return true;
  }

  if (/^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/.test(value)) {
    return true;
  }

  return false;
}

export function looksLikeRealSecret(
  value: string,
  normalizedKey: string
): boolean {
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

  if (/[(){}[\]<>]|=>|`|\\/.test(trimmed)) {
    return false;
  }

  if (/^[a-zA-Z]+(?:\s+[a-zA-Z]+){2,}$/.test(trimmed)) {
    return false;
  }

  if (!isPasswordKey && /\s/.test(trimmed)) {
    return false;
  }

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
    if (looksLikeIdentifierOrPath(trimmed)) {
      return false;
    }

    return e >= WEAK_KEY_MIN_ENTROPY;
  }

  const threshold = isPasswordKey ? 2.0 : 3.0;

  return e >= threshold;
}
