/**
 * Layer 3 — subagent posture. Stricter network policy when pi runs headless
 * (`ctx.hasUI === false`).
 */

import { SubagentNetwork } from "../core/index";
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
	if (ctx.hasUI !== false) return null;
	const mode = policy.subagent?.network ?? SubagentNetwork.Allow;
	if (mode === SubagentNetwork.Allow) return null;
	if (mode === SubagentNetwork.Deny) return "Network blocked by policy: subagent.network=deny. Nothing was fetched — ask the user.";
	if (mode === SubagentNetwork.ResearchOnly) {
		const sessionManager = ctx.sessionManager as { getBranch?: () => Array<{ type: string; text?: string }> } | undefined;
		const branch = sessionManager?.getBranch?.() ?? [];
		const recentText = branch
			.slice(-10)
			.map((entry) => (typeof entry.text === "string" ? entry.text : ""))
			.join(" ")
			.toLowerCase();
		for (const agent of RESEARCH_AGENTS) if (recentText.includes(agent)) return null;
		return "Network blocked by policy: subagent.network=research-only. Nothing was fetched — ask the user.";
	}
	return null;
}
