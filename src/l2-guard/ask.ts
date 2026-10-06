/**
 * Layer 2 ask-tier decision mapping (ADR-009, ADR-010).
 *
 * Pure UI→decision logic: no pi, no fs, no audit. The caller supplies a
 * `ctx.ui.select`; this module only decides which option string means what.
 * Kept separate so the contract tests can script the answers.
 */

import { dirname } from "node:path";

export type OverrideKind = "allowRead" | "allowWrite" | "allowDomains";

export type AskKind = {
	layer: 2;
	tool: string;
	subject: string;
	reason: string;
	overrideKind: OverrideKind;
	overrideValue: string;
	/** A read outside the project (ADR-012); only these may be allowed because the user named the path. */
	outside?: boolean;
	/** Absolute path as the call spelled it, before symlink resolution (/tmp vs /private/tmp). */
	spelled?: string;
};

export type Decision = "yes" | "no" | "session" | "session-folder" | "always-cwd" | "always-global" | "always-cwd-folder" | "always-global-folder";

/** The slice of pi's ctx that `askDecision` uses. */
export type AskCtx = {
	hasUI?: boolean;
	ui: {
		select: (t: string, o: string[], op?: { timeout?: number }) => Promise<string | undefined>;
	};
};

export async function askDecision(ctx: AskCtx, k: AskKind, absoluteDenyPattern: string | null): Promise<Decision> {
	if (ctx.hasUI === false) return "no"; // subagents, -p, JSON mode
	if (absoluteDenyPattern) {
		// Two deliberate steps (ADR-009). Both are select menus whose first,
		// pre-selected option blocks, so Enter-Enter can never approve. pi's
		// ctx.ui.confirm is not used: it lists "Yes" first and pre-selects it.
		const banner = `⚠️  HIGH-RISK BLOCK — Layer 2\n\nTool:    ${k.tool}\nSubject: ${k.subject}\nReason:  ${k.reason}\nMatched absolute-deny tier: ${absoluteDenyPattern}\n\nAccess to credential material is almost always exfiltration.\n"always" is not available for this tier.`;
		const step1 = ["no  — block (default)", "allow this ONE call"];
		if ((await ctx.ui.select(banner, step1, { timeout: 60_000 })) !== step1[1]) return "no";
		const step2 = ["No  — keep it blocked (default)", "Yes — allow this ONE call"];
		const check = `Really allow ${k.tool} on credential material?\n\n${k.subject}`;
		return (await ctx.ui.select(check, step2, { timeout: 30_000 })) === step2[1] ? "yes" : "no";
	}
	const isFileKind = k.overrideKind === "allowRead" || k.overrideKind === "allowWrite";
	const parentDir = isFileKind ? dirname(k.overrideValue) : null;
	const title = `Layer 2 block: ${k.tool}\n\nSubject: ${k.subject}\nReason:  ${k.reason}\n\nAllow?`;
	// "no" first and pre-selected: Enter alone blocks (ADR-010).
	const options: string[] = ["no  — block (default)", "yes — this once", "yes — for this session (not saved)"];
	if (isFileKind) options.push(`yes — for this session: parent folder ${parentDir} (not saved)`);
	options.push("always for CURRENT project — whitelist this file (.pi/sandbox.json)");
	if (isFileKind) options.push(`always for CURRENT project — whitelist parent folder ${parentDir} (.pi/sandbox.json)`);
	options.push("always for ALL projects — whitelist this file (~/.pi/agent/extensions/sandbox.json)");
	if (isFileKind) options.push(`always for ALL projects — whitelist parent folder ${parentDir} (~/.pi/agent/extensions/sandbox.json)`);
	const chosen = await ctx.ui.select(title, options, { timeout: 60_000 });
	if (!chosen || chosen === options[0]) return "no";
	if (chosen === options[1]) return "yes";
	if (chosen.startsWith("yes — for this session")) return chosen.includes("parent folder") ? "session-folder" : "session";
	if (chosen.startsWith("always for CURRENT project")) return chosen.includes("parent folder") ? "always-cwd-folder" : "always-cwd";
	if (chosen.startsWith("always for ALL projects")) return chosen.includes("parent folder") ? "always-global-folder" : "always-global";
	return "no";
}
