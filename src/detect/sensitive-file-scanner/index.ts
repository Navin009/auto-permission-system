/**
 * File-gate scanner (vendored core, ADR-018). Public surface only: the
 * scan contract types, tunable caps, the shared text scanner used by the
 * tool-output gate, and the file/read entrypoints.
 */
export * from "./types";
export { MAX_FILE_SIZE_BYTES, DEFAULT_ASK_THRESHOLD } from "./constants";
export { normalizeKey, isSensitiveKey } from "./keys";
export { isPlaceholder } from "./value-analysis";
export { redactText } from "./redaction";
export { scanTextContent } from "./content-scan";
export { scanFile, evaluateRead } from "./file-scan";
