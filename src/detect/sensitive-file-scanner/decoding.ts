/**
 * Bounded read + text decoding.
 *
 * Handles UTF-8, UTF-8 BOM and UTF-16 (BOM or alternating-NUL
 * heuristic); returns null for binary content. Files are read with
 * O_NOFOLLOW so a symlink swap cannot redirect the read.
 */

import { promises as fs } from "node:fs";

export interface DecodedText {
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

  if (replacements / sampleLength > 0.01 || suspicious / sampleLength > 0.1) {
    return null;
  }

  return { text, encoding };
}

/**
 * Decode a buffer only if it is text. Returns null for binary.
 */
export function decodeTextBuffer(buffer: Buffer): DecodedText | null {
  if (buffer.length === 0) {
    return { text: "", encoding: "utf8" };
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
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
export async function readFileCapped(
  filePath: string,
  maxBytes: number
): Promise<Buffer> {
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
