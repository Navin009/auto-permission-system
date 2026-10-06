/**
 * Layer 2 ask-tier decision mapping (ADR-009, ADR-010).
 *
 * Pure UI→decision logic: no pi, no fs, no audit. The caller supplies a
 * `ctx.ui.select`; this module only decides which option string means what.
 * The shared two-screen UI primitives live in `../ui/ask-flow.ts`.
 */

import { dirname } from "node:path";
import { askMain, askRememberFile, askRememberHost, type AskCtx } from "../ui/ask-flow";

export type { AskCtx } from "../ui/ask-flow";

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
	const main = await askMain(ctx, header, detailLines(k, action), { session: true });
	if (main === "block") return "no";
	if (main === "once") return "yes";
	if (main === "session") return "session";

	// Screen 2 — scope + what to allow.
	if (action === "network") {
		const picked = await askRememberHost(ctx, "Remember this host?", `  host: ${k.overrideValue}`, k.overrideValue);
		if (!picked) return "no";
		return picked.scope === "cwd" ? "always-cwd" : "always-global";
	}
	const parent = dirname(k.subject);
	const picked = await askRememberFile(ctx, `Remember this ${action}?`, `  file:   ${k.subject}\n  folder: ${parent}`, k.subject, parent);
	if (!picked) return "no";
	if (picked.scope === "cwd") return picked.folder ? "always-cwd-folder" : "always-cwd";
	return picked.folder ? "always-global-folder" : "always-global";
}
