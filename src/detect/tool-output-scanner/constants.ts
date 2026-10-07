/**
 * Tunable limits for the output scanner.
 *
 * SIZE POLICY (performance + security):
 *   - Default scan limit: 64 KiB. Hard ceiling: 256 KiB.
 *   - The size is measured first and stops as soon as the limit is
 *     exceeded, so an oversized output costs O(limit), not O(output).
 *   - An output above the limit is SKIPPED entirely: no detectors run,
 *     and the result is "ask" (`OUTPUT_TOO_LARGE`). This keeps multi-tool
 *     loops fast while never silently forwarding unverified output.
 */

/** 64 KiB: ~10–25 ms per scan, safe for many tool calls per turn. */
export const TOOL_OUTPUT_DEFAULT_MAX_BYTES = 64 * 1024;
/** 256 KiB: opt-in ceiling; larger outputs are skipped (fail closed). */
export const TOOL_OUTPUT_HARD_MAX_BYTES = 256 * 1024;
export const TOOL_OUTPUT_DEFAULT_ASK_THRESHOLD = 30;
export const TOOL_OUTPUT_MAX_DEPTH = 8;
export const TOOL_OUTPUT_MAX_NODES = 2000;

export const MAX_LEAF_BYTES = 32 * 1024;
export const MAX_BASE64_DECODED = 64 * 1024;
export const BASE64_BLOB_REGEX = /[A-Za-z0-9+/]{32,}={0,2}/g;
