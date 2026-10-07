/**
 * Layer 0 filename classifier (vendored core, ADR-018). Public surface:
 * the verdict types, the risk-score table, and the two entrypoints used
 * by the read scanner.
 */
export type { NameRisk, NameVerdict } from "./types";
export { RISK_SCORES } from "./types";
export { SOURCE_EXTENSIONS } from "./patterns";
export { isSourceExtension, classifyFilename } from "./classify";
