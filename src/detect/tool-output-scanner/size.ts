/**
 * Size measurement. Never materializes the output; stops as soon as the
 * limit is exceeded.
 */

import {
  TOOL_OUTPUT_DEFAULT_MAX_BYTES,
  TOOL_OUTPUT_HARD_MAX_BYTES,
  TOOL_OUTPUT_MAX_NODES,
} from "./constants";
import type { SizeEstimate } from "./types";

export function clampLimit(value: number | undefined): number {
  const requested = value ?? TOOL_OUTPUT_DEFAULT_MAX_BYTES;
  return Math.min(Math.max(1, requested), TOOL_OUTPUT_HARD_MAX_BYTES);
}

/**
 * Measure the output size without materializing it, stopping as soon as
 * the limit is exceeded. For a plain string the size is exact; for a
 * structure it is an approximate serialized size.
 */
export function estimateSize(output: unknown, limit: number): SizeEstimate {
  if (typeof output === "string") {
    const bytes = Buffer.byteLength(output);
    return { bytes, exceeded: bytes > limit, exact: true };
  }

  let bytes = 0;
  let nodes = 0;
  const stack: unknown[] = [output];

  while (stack.length > 0) {
    if (nodes++ > TOOL_OUTPUT_MAX_NODES) {
      return { bytes, exceeded: true, exact: false };
    }

    const current = stack.pop();

    if (typeof current === "string") {
      bytes += current.length + 2;
    } else if (typeof current === "number") {
      bytes += 8;
    } else if (typeof current === "boolean") {
      bytes += 5;
    } else if (current === null || current === undefined) {
      bytes += 4;
    } else if (Array.isArray(current)) {
      bytes += 2;

      for (let i = 0; i < current.length; i++) {
        stack.push(current[i]);
        bytes += 4;

        if (bytes > limit || stack.length > TOOL_OUTPUT_MAX_NODES) {
          return { bytes, exceeded: true, exact: false };
        }
      }
    } else if (typeof current === "object") {
      bytes += 2;

      for (const [key, child] of Object.entries(
        current as Record<string, unknown>
      )) {
        bytes += key.length + 4;
        stack.push(child);

        if (bytes > limit || stack.length > TOOL_OUTPUT_MAX_NODES) {
          return { bytes, exceeded: true, exact: false };
        }
      }
    }

    if (bytes > limit) {
      return { bytes, exceeded: true, exact: false };
    }
  }

  return { bytes, exceeded: false, exact: false };
}
