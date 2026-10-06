/**
 * Layer 2 ask-tier decision mapping (ADR-009, ADR-010).
 *
 * Pure UI→decision logic: no pi, no fs, no audit. The caller supplies a
 * `ctx.ui.select`; this module only decides which option string means what.
 * Kept separate so the contract tests can script the answers.
 *
 * Two screens:
 *   1. a short verdict + `Block / Allow once / Allow for this session / Allow and remember…`
 *   2. only if "remember": `Allow for this file (<path>) - Scope this project|global`
 * Esc / timeout on either screen blocks.
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

type Action = "read" | "write" | "network";

function actionOf(k: AskKind): Action {
	if (k.overrideKind === "allowDomains") return "network";
	if (k.overrideKind === "allowWrite") return "write";
	return "read";
}

/** The reason without the trailing `→ /abs/path` (the body already shows the path). */
export function displayWhy(reason: string): string {
	return reason.replace(/\s*→\s*.*$/, "");
}

/** A domain reason without its `: host` suffix, so it can sit next to `host:` without repeating it. */
export function networkWhy(reason: string): string {
	return reason.startsWith("domain not in allowlist") ? "not in the allowlist" : displayWhy(reason);
}

/** The model-facing denial text: one pattern for every Layer 2 block. */
export function denyMessage(overrideKind: OverrideKind, reason: string): string {
	if (overrideKind === "allowDomains") return `Network blocked by policy: ${networkWhy(reason)}. Nothing was fetched — ask the user.`;
	if (overrideKind === "allowWrite") return `Write blocked by policy: ${displayWhy(reason)}. Nothing was written — ask the user.`;
	return `Read blocked by policy: ${displayWhy(reason)}. Nothing was read — ask the user.`;
}

/** The short body shared by screen 1 and the credential banner. */
function detailLines(k: AskKind, action: Action): string {
	if (action === "network") return `  host:  ${k.overrideValue}\n  why:   ${networkWhy(k.reason)}`;
	return `  file:  ${k.subject}\n  why:   ${displayWhy(k.reason)}`;
}

export async function askDecision(ctx: AskCtx, k: AskKind, absoluteDenyPattern: string | null): Promise<Decision> {
	if (ctx.hasUI === false) return "no"; // subagents, -p, JSON mode
	const action = actionOf(k);

	if (absoluteDenyPattern) {
		// Two deliberate steps (ADR-009). Both selects pre-select the blocking
		// option, so Enter-Enter can never approve. "always" is not offered here.
		const banner = `⚠  Credential access blocked\n${detailLines(k, action)}`;
		const step1 = ["Block (default)", "Allow this one call"];
		if ((await ctx.ui.select(banner, step1, { timeout: 60_000 })) !== step1[1]) return "no";
		const check = `Confirm: allow one ${action} of credential material?`;
		const step2 = ["No — keep blocked (default)", "Yes — allow once"];
		return (await ctx.ui.select(check, step2, { timeout: 30_000 })) === step2[1] ? "yes" : "no";
	}

	// Screen 1 — verdict + duration.
	const header = action === "network" ? "Network access blocked" : `${action === "write" ? "Write" : "Read"} blocked by policy`;
	const main = ["Block (default)", "Allow once", "Allow for this session", "Allow and remember…"];
	const choice = await ctx.ui.select(`${header}\n${detailLines(k, action)}`, main, { timeout: 60_000 });
	if (!choice || choice === main[0]) return "no";
	if (choice === main[1]) return "yes";
	if (choice === main[2]) return "session";

	// Screen 2 — scope + what to allow (only after "Allow and remember…").
	if (action === "network") {
		const host = k.overrideValue;
		const options = [
			`Allow for this host (${host}) - Scope this project`,
			`Allow for this host (${host}) - Scope global`,
		];
		const picked = await ctx.ui.select(`Remember this host?\n  host: ${host}`, options, { timeout: 60_000 });
		if (picked === options[0]) return "always-cwd";
		if (picked === options[1]) return "always-global";
		return "no";
	}
	const parent = dirname(k.subject);
	const options = [
		`Allow for this file (${k.subject}) - Scope this project`,
		`Allow for this folder (${parent}) - Scope this project`,
		`Allow for this file (${k.subject}) - Scope global`,
		`Allow for this folder (${parent}) - Scope global`,
	];
	const picked = await ctx.ui.select(`Remember this ${action}?\n  file:   ${k.subject}\n  folder: ${parent}`, options, { timeout: 60_000 });
	if (picked === options[0]) return "always-cwd";
	if (picked === options[1]) return "always-cwd-folder";
	if (picked === options[2]) return "always-global";
	if (picked === options[3]) return "always-global-folder";
	return "no";
}
