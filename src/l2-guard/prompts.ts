/**
 * Layer 2 ask-tier prompts, session grants, and persisted "always" overrides
 * (ADR-009, ADR-010). Owns the interactive UI calls; policy decisions come from
 * matching.ts.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { extractUserMessages, readPolicyForUpdate, recordProjectTrust, userNamedFile } from "../core/index";
import { audit } from "../shared/audit";
import { canonicalize, matchPattern } from "./matching";
import { projectTrusted, TRUST_STORE } from "./policy";
import { domainMatches } from "./url";
import { askDecision, denyMessage, type AskKind, type OverrideKind } from "../ui/ask";

export type { AskKind, Decision, OverrideKind } from "../ui/ask";
export type Scope = "cwd" | "global";

export function persistOverride(scope: Scope, cwd: string, kind: OverrideKind, value: string): string {
	const { dir, path } =
		scope === "cwd"
			? { dir: join(cwd, ".pi"), path: join(cwd, ".pi", "sandbox.json") }
			: { dir: join(getAgentDir(), "extensions"), path: join(getAgentDir(), "extensions", "sandbox.json") };
	// Never write a grant into a project file whose current content the user has
	// not trusted: recording the new hash would trust whatever else is in it.
	if (scope === "cwd" && !projectTrusted(cwd)) {
		throw new Error(`${path} is not trusted; run /security trust first, or choose an "ALL projects" option`);
	}
	// Throws on an unparseable file: never overwrite a hand-written policy we could not read.
	const existing = readPolicyForUpdate(path) as Record<string, unknown> & { overrides?: Record<OverrideKind, string[]> };
	const overrides = (existing.overrides ?? {}) as Record<OverrideKind, string[]>;
	const list = (overrides[kind] ?? []) as string[];
	if (!list.includes(value)) list.push(value);
	overrides[kind] = list;
	existing.overrides = overrides;
	mkdirSync(dir, { recursive: true });
	writeFileSync(path, `${JSON.stringify(existing, null, 2)}\n`);
	if (scope === "cwd") recordProjectTrust(path, TRUST_STORE);
	return path;
}

/**
 * Grants from "yes — for this session" (ADR-010). In memory only, cleared on
 * session_start, never written to sandbox.json, never consulted for the
 * absolute-deny tier.
 */
const sessionGrants: Array<{ kind: OverrideKind; value: string }> = [];

export function clearSessionGrants(): void {
	sessionGrants.length = 0;
}

export function sessionGrantSummary(): string {
	return sessionGrants.map((g) => `${g.kind}:${g.value}`).join(", ");
}

function sessionGranted(k: AskKind, cwd: string): string | null {
	for (const g of sessionGrants) {
		if (g.kind !== k.overrideKind) continue;
		const hit = g.kind === "allowDomains" ? domainMatches(k.overrideValue, g.value) : matchPattern(k.subject, g.value, cwd);
		if (hit) return g.value;
	}
	return null;
}

export type UICtx = {
	cwd: string;
	hasUI?: boolean;
	ui: {
		select: (t: string, o: string[], op?: { timeout?: number }) => Promise<string | undefined>;
		input: (t: string, p?: string, op?: { timeout?: number }) => Promise<string | undefined>;
		notify: (m: string, l?: string) => void;
	};
};

export async function askOrBlock(ctx: UICtx, k: AskKind, absoluteDenyPattern: string | null, onPersist?: (kind: OverrideKind, value: string, scope: Scope) => void): Promise<{ block: true; reason: string } | null> {
	if (!absoluteDenyPattern) {
		const granted = sessionGranted(k, ctx.cwd);
		if (granted) {
			audit({ layer: 2, tool: k.tool, subject: k.subject, reason: k.reason, decision: "session-grant", grant: granted, cwd: ctx.cwd });
			return null;
		}
		// Interactive only: headless "user" messages may be written by another model.
		if (k.outside && ctx.hasUI !== false) {
			const named = userNamedOutside(ctx as SessionCtx, k);
			if (named) {
				audit({ layer: 2, tool: k.tool, subject: k.subject, reason: k.reason, decision: "user-named", named, cwd: ctx.cwd });
				ctx.ui.notify(`security-guard: read outside the project allowed once → ${k.subject} (you named "${named}")`, "info");
				return null;
			}
		}
	}
	const decision = await askDecision(ctx, k, absoluteDenyPattern);
	if (decision === "no") {
		audit({ layer: 2, tool: k.tool, subject: k.subject, reason: k.reason, decision: "no", cwd: ctx.cwd });
		return { block: true, reason: denyMessage(k.overrideKind, k.reason) };
	}
	if (decision === "session" || decision === "session-folder") {
		const value = decision === "session-folder" ? dirname(k.overrideValue) : k.overrideValue;
		sessionGrants.push({ kind: k.overrideKind, value });
		audit({ layer: 2, tool: k.tool, subject: k.subject, reason: k.reason, decision, grant: value, cwd: ctx.cwd });
		ctx.ui.notify(`security-guard: allowed for this session (not saved) → ${value}`, "info");
		return null;
	}
	if (decision === "always-cwd" || decision === "always-global" || decision === "always-cwd-folder" || decision === "always-global-folder") {
		if (absoluteDenyPattern) {
			audit({ layer: 2, tool: k.tool, subject: k.subject, reason: k.reason, decision: "no", note: "always-refused-for-absolute-deny", cwd: ctx.cwd });
			return { block: true, reason: denyMessage(k.overrideKind, k.reason) };
		}
		const scope: Scope = decision === "always-cwd" || decision === "always-cwd-folder" ? "cwd" : "global";
		const useFolder = decision === "always-cwd-folder" || decision === "always-global-folder";
		const value = useFolder ? dirname(k.overrideValue) : k.overrideValue;
		try {
			const path = persistOverride(scope, ctx.cwd, k.overrideKind, value);
			onPersist?.(k.overrideKind, value, scope);
			audit({ layer: 2, tool: k.tool, subject: k.subject, reason: k.reason, decision, scope, granularity: useFolder ? "folder" : "file", cwd: ctx.cwd, persisted_to: path, override: { [k.overrideKind]: value } });
			ctx.ui.notify(`security-guard: persisted ${scope}${useFolder ? " (folder)" : ""} override → ${path}`, "warning");
		} catch (e) {
			audit({ layer: 2, tool: k.tool, subject: k.subject, reason: k.reason, decision: "yes", note: `always-persist-failed: ${e}`, scope, cwd: ctx.cwd });
			ctx.ui.notify(`security-guard: could not persist ${scope} override (${e}); allowing this call only`, "warning");
		}
		return null;
	}
	audit({ layer: 2, tool: k.tool, subject: k.subject, reason: k.reason, decision: "yes", cwd: ctx.cwd });
	return null;
}

type SessionCtx = UICtx & { sessionManager?: { getBranch?: () => unknown[] } };

/** The spelling of an outside-project path the user named in their own messages, or null (src/core/user-named.ts). */
function userNamedOutside(ctx: SessionCtx, k: AskKind): string | null {
	const messages = extractUserMessages(ctx.sessionManager?.getBranch?.() ?? []);
	if (!messages.length) return null;
	return userNamedFile(messages, { canonical: k.subject, spelled: k.spelled, cwd: canonicalize(ctx.cwd, ctx.cwd), home: homedir() });
}
