/**
 * Layer 2 ask-tier prompts, session grants, and persisted "always" overrides
 * (ADR-009, ADR-010). Owns the interactive UI calls; policy decisions come from
 * matching.ts.
 */

import { homedir } from "node:os";
import { dirname } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { addOverride, addProjectOverride, extractUserMessages, globalPolicyPath, isSafeFolderGrant, projectPolicyPath, userNamedFile, GrantScope, OverrideKind } from "../core/index";
import { audit } from "../shared/audit";
import { canonicalize, matchPattern } from "./matching";
import { projectTrusted, TRUST_STORE } from "./policy";
import { domainMatches } from "./url";
import { askDecision, denyMessage, Decision, type AskCtx, type AskKind } from "../ui/ask";

export type { AskKind, Decision, OverrideKind } from "../ui/ask";

/**
 * Append a grant to the persisted `overrides` section.
 *
 * Never writes into a project file whose current content the user has not
 * trusted: recording the new hash would trust whatever else is in it. The
 * caller has already hidden the `in this project` rows for that case.
 */
export function persistOverride(scope: GrantScope, cwd: string, kind: OverrideKind, value: string): string {
	const path = scope === GrantScope.Cwd ? projectPolicyPath(cwd) : globalPolicyPath(getAgentDir());
	if (scope === GrantScope.Cwd && !projectTrusted(cwd)) {
		throw new Error(`${path} is not trusted; run /security trust first, or choose an "ALL projects" option`);
	}
	return scope === GrantScope.Cwd ? addProjectOverride(path, TRUST_STORE, kind, value) : addOverride(path, kind, value);
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
	return sessionGrants.map((grant) => `${grant.kind}:${grant.value}`).join(", ");
}

function sessionGranted(ask: AskKind, cwd: string): string | null {
	for (const grant of sessionGrants) {
		if (grant.kind !== ask.overrideKind) continue;
		const matched = grant.kind === OverrideKind.AllowDomains ? domainMatches(ask.overrideValue, grant.value) : matchPattern(ask.subject, grant.value, cwd);
		if (matched) return grant.value;
	}
	return null;
}

export type UICtx = {
	cwd: string;
	hasUI?: boolean;
	/** pi's run mode; `"tui"` enables the custom footer selector (ADR-031). */
	mode?: string;
	ui: AskCtx["ui"] & {
		input: (t: string, p?: string, op?: { timeout?: number }) => Promise<string | undefined>;
		notify: (m: string, l?: string) => void;
	};
};

/**
 * Ask the user, then apply the answer: session grants stay in memory, "always"
 * grants are persisted and announced to the other layer via `onPersist`.
 * Headless asks deny. A `null` return means the call may proceed.
 */
export async function askOrBlock(
	ctx: UICtx,
	ask: AskKind,
	absoluteDenyPattern: string | null,
	onPersist?: (kind: OverrideKind, value: string, scope: GrantScope) => void,
): Promise<{ block: true; reason: string } | null> {
	if (!absoluteDenyPattern) {
		const granted = sessionGranted(ask, ctx.cwd);
		if (granted) {
			audit({ layer: 2, tool: ask.tool, subject: ask.subject, reason: ask.reason, decision: "session-grant", grant: granted, cwd: ctx.cwd });
			return null;
		}
		// Interactive only: headless "user" messages may be written by another model.
		if (ask.outside && ctx.hasUI !== false) {
			const named = userNamedOutside(ctx as SessionCtx, ask);
			if (named) {
				audit({ layer: 2, tool: ask.tool, subject: ask.subject, reason: ask.reason, decision: "user-named", named, cwd: ctx.cwd });
				ctx.ui.notify(`security-guard: read outside the project allowed once → ${ask.subject} (you named "${named}")`, "info");
				return null;
			}
		}
	}
	const decision = await askDecision(ctx, { ...ask, projectTrusted: projectTrusted(ctx.cwd) }, absoluteDenyPattern);
	if (decision === Decision.No) {
		audit({ layer: 2, tool: ask.tool, subject: ask.subject, reason: ask.reason, decision: "no", cwd: ctx.cwd });
		return { block: true, reason: denyMessage(ask.overrideKind, ask.reason) };
	}
	if (decision === Decision.Session || decision === Decision.SessionFolder) {
		// ADR-030: a session grant for a file covers the whole folder, so a CLI writing
		// many files under ~/.composio/ stops re-prompting after the first grant. Falls
		// back to the exact path when the parent folder is unsafe (root, home, …).
		const parent = ask.overrideKind === OverrideKind.AllowDomains ? ask.overrideValue : dirname(ask.overrideValue);
		const value = ask.overrideKind === OverrideKind.AllowDomains || isSafeFolderGrant(parent, homedir()) ? parent : ask.overrideValue;
		sessionGrants.push({ kind: ask.overrideKind, value });
		audit({ layer: 2, tool: ask.tool, subject: ask.subject, reason: ask.reason, decision, grant: value, cwd: ctx.cwd });
		ctx.ui.notify(`security-guard: allowed for this session (not saved) → ${value}`, "info");
		return null;
	}
	if (decision === Decision.AlwaysCwd || decision === Decision.AlwaysGlobal || decision === Decision.AlwaysCwdFolder || decision === Decision.AlwaysGlobalFolder) {
		if (absoluteDenyPattern) {
			audit({ layer: 2, tool: ask.tool, subject: ask.subject, reason: ask.reason, decision: "no", note: "always-refused-for-absolute-deny", cwd: ctx.cwd });
			return { block: true, reason: denyMessage(ask.overrideKind, ask.reason) };
		}
		const scope = decision === Decision.AlwaysCwd || decision === Decision.AlwaysCwdFolder ? GrantScope.Cwd : GrantScope.Global;
		const useFolder = decision === Decision.AlwaysCwdFolder || decision === Decision.AlwaysGlobalFolder;
		const value = useFolder ? dirname(ask.overrideValue) : ask.overrideValue;
		try {
			const path = persistOverride(scope, ctx.cwd, ask.overrideKind, value);
			onPersist?.(ask.overrideKind, value, scope);
			audit({ layer: 2, tool: ask.tool, subject: ask.subject, reason: ask.reason, decision, scope, granularity: useFolder ? "folder" : "file", cwd: ctx.cwd, persisted_to: path, override: { [ask.overrideKind]: value } });
			ctx.ui.notify(`security-guard: persisted ${scope}${useFolder ? " (folder)" : ""} override → ${path}`, "warning");
		} catch (error) {
			audit({ layer: 2, tool: ask.tool, subject: ask.subject, reason: ask.reason, decision: "yes", note: `always-persist-failed: ${error}`, scope, cwd: ctx.cwd });
			ctx.ui.notify(`security-guard: could not persist ${scope} override (${error}); allowing this call only`, "warning");
		}
		return null;
	}
	audit({ layer: 2, tool: ask.tool, subject: ask.subject, reason: ask.reason, decision: "yes", cwd: ctx.cwd });
	return null;
}

type SessionCtx = UICtx & { sessionManager?: { getBranch?: () => unknown[] } };

/** The spelling of an outside-project path the user named in their own messages, or null (src/core/user-named.ts). */
function userNamedOutside(ctx: SessionCtx, ask: AskKind): string | null {
	const messages = extractUserMessages(ctx.sessionManager?.getBranch?.() ?? []);
	if (!messages.length) return null;
	return userNamedFile(messages, { canonical: ask.subject, spelled: ask.spelled, cwd: canonicalize(ctx.cwd, ctx.cwd), home: homedir() });
}
