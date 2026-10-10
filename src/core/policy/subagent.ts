/**
 * Layer 3 vocabulary: the `subagent.network` posture (ADR-005). Pure.
 */

/** Erasable enum for `subagent.network`. */
export const SubagentNetwork = {
	Allow: "allow",
	Deny: "deny",
	ResearchOnly: "research-only",
} as const;
export type SubagentNetwork = (typeof SubagentNetwork)[keyof typeof SubagentNetwork];
