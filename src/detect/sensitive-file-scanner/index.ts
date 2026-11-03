/**
 * File-gate scanner (vendored core, ADR-018). Public surface only: the
 * scan contract types, tunable caps, the shared text scanner used by the
 * tool-output gate, and the file/read entrypoints.
 */
export * from "./types.ts";
export { MAX_FILE_SIZE_BYTES, DEFAULT_ASK_THRESHOLD } from "./constants.ts";
export { normalizeKey, isSensitiveKey } from "./keys.ts";
export { isPlaceholder } from "./value-analysis.ts";
export { redactText } from "./redaction.ts";
export { scanTextContent } from "./content-scan.ts";
export { scanFile, evaluateRead } from "./file-scan.ts";
