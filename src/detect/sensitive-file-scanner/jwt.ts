/**
 * JWT detection without a backtracking regex.
 *
 * A JWT is one token of base64url characters containing exactly three
 * dot-separated segments. The token regex is a single greedy character
 * class (linear, no trailing atom), and each token is inspected once.
 */

function isWordCharCode(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) || // 0-9
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x61 && code <= 0x7a) || // a-z
    code === 0x5f // _
  );
}

export const TOKEN_REGEX = /[A-Za-z0-9_.-]+/g;

export function isJwtToken(token: string): boolean {
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

export function containsJwt(content: string): boolean {
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
