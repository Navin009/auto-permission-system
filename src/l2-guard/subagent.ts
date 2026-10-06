/**
 * Layer 3 — subagent posture. Stricter network policy when pi runs headless
 * (`ctx.hasUI === false`).
 */

import type { Policy } from "./policy";

const RESEARCH_AGENTS = new Set(["librarian", "scout", "researcher"]);

/**
 * Decide if a network-bound tool call should be blocked under the current
 * subagent posture. Returns a reason string when blocked, or null to allow.
 *
 * Heuristic for "is research agent": pi doesn't expose an agent name on
 * `ctx`, so we look at the most recent assistant text in the session for a
 * known research-agent marker. Best-effort — v2 should plumb agent
 * identity through `ctx`.
 */
export function subagentNetworkBlock(ctx: { hasUI?: boolean; sessionManager?: unknown }, policy: Policy): string | null {
	if (ctx.hasUI !== false) return null; // only applies headless
	const mode = policy.subagent?.network ?? "allow";
	if (mode === "allow") return null;
	if (mode === "deny") return "subagent network access denied (policy: subagent.network=deny)";
	if (mode === "research-only") {
		// Best-effort: scan recent session for a known research-agent name.
		const sm = ctx.sessionManager as { getBranch?: () => Array<{ type: string; text?: string }> } | undefined;
		const branch = sm?.getBranch?.() ?? [];
		const joined = branch
			.slice(-10)
			.map((e) => (typeof e.text === "string" ? e.text : ""))
			.join(" ")
			.toLowerCase();
		for (const a of RESEARCH_AGENTS) if (joined.includes(a)) return null;
		return "subagent network access denied (policy: subagent.network=research-only)";
	}
	return null;
}
