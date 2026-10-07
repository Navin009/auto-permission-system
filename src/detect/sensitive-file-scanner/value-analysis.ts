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
