/**
 * Assignment parsing.
 *
 * Extracts `key = value` / `key: value` pairs from a single line, with
 * bounded lookahead for block-style values on the following line:
 *
 *   PASSWORD=
 *   <value>
 *
 *   password: >
 *     <value>
 */

import { isSourceExtension } from "../filename-gate/index";
import { isSensitiveKey, normalizeKey } from "./keys";

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

    if (
      previous === "=" ||
      previous === "!" ||
      previous === "<" ||
      previous === ">"
    ) {
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

interface AssignmentAnalysis {
  keyword: string;
  value: string | null;
  valueStart: number;
  valueEnd: number;
  block: boolean;
}

const BLOCK_VALUE_REGEX = /^(?:[|>][+-]?|\\)$/;

export function analyzeAssignment(
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

export { findContinuationValue };

/**
 * Extensions / names where an unquoted value is a real literal (shell,
 * Dockerfile, HCL, SQL, env/config). In code files such as .ts/.py/.go an
 * unquoted value is usually an expression (`generateToken()`), so it is
 * ignored.
 */
export function allowsUnquotedAssignment(
  fileName: string,
  extension: string
): boolean {
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
