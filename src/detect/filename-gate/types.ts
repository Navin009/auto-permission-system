/**
 * Layer 0 filename-classifier contract.
 *
 * Design rules:
 *   - The filename is a PRIOR, not the whole decision. `scanFile` content-
 *     scans all regular text files, so a source file with a hardcoded
 *     credential is still detected even when this classifier says
 *     `candidate: false`.
 *   - Generic keywords match WHOLE TOKENS, not substrings:
 *     `tokenizer.json` -> no, `secrets.json` -> yes.
 *   - A filename can only raise risk, never lower it.
 */

export type NameRisk = "none" | "weak" | "config" | "generic" | "strong";

export interface NameVerdict {
  candidate: boolean;
  risk: NameRisk;
  score: number;
  reasons: string[];
}

/**
 * Score contributed purely by the filename. All tiers except `weak`
 * meet the default ask threshold (30), so the name alone can force
 * "ask" even when the content looks clean.
 */
export const RISK_SCORES: Record<Exclude<NameRisk, "none">, number> = {
  weak: 15,
  config: 30,
  generic: 35,
  strong: 45,
};
