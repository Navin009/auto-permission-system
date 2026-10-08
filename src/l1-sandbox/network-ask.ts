/**
 * Layer 1 network ask (ADR-023): the sandbox-runtime proxy asks before it
 * denies a host that matched neither `allowedDomains` nor `deniedDomains`.
 * Uses the same two-screen ask-tier as Layer 2 (once / session / remember
 * project|global) and the same grant semantics:
 *
 * - session grants: in memory only, cleared at `session_start`, never saved;
 * - "once" grants: one bash command's connections to that host (the proxy
 *   calls back per request, so a redirect or a parallel connection must not
 *   re-prompt), scoped by `beginNetworkCommand`/`endNetworkCommand`;
 * - remember grants: written to `overrides.allowDomains` by the caller and
 *   applied live with `SandboxManager.updateConfig` (a reload here would tear
 *   down the proxy serving the request being approved).
 *
 * Headless (`hasUI === false`) denies, like every other gate.
 */

import { domainMatches } from "../core/index";
import { askDecision, type AskCtx, type AskKind } from "../ui/ask";

/** In-memory session grants ("Allow for this session"). Cleared at session_start. */
const sessionGrants: string[] = [];
/** Hosts allowed for the current bash command ("Allow once" covers its connections). */
let commandGrants: Set<string> | null = null;
let commandDepth = 0;
/** Single-flight: one prompt per host even when several connections overlap. */
const pending = new Map<string, Promise<boolean>>();

export function clearNetworkSessionGrants(): void {
	sessionGrants.length = 0;
}

export function networkSessionGrantSummary(): string {
	return sessionGrants.join(", ");
}

export function beginNetworkCommand(): void {
	commandDepth += 1;
	commandGrants ??= new Set();
}

export function endNetworkCommand(): void {
	commandDepth = Math.max(0, commandDepth - 1);
	if (commandDepth === 0) commandGrants = null;
}

/** The active pi context at ask time (set at session_start; sandbox.ts owns it). */
export type NetworkAskCtx = AskCtx & {
	ui: AskCtx["ui"] & { notify?: (m: string, l?: string) => void };
};

export interface NetworkAskDeps {
	cwd: string;
	getCtx: () => NetworkAskCtx | undefined;
	/** Write the host into `overrides.allowDomains` (file only); returns the path written. */
	persist: (host: string, scope: "cwd" | "global") => Promise<string>;
	/** Make a grant effective in the running sandbox without restarting the proxy. */
	applyLive: (host: string) => void;
	audit: (entry: Record<string, unknown>) => void;
}

function granted(host: string): "session" | "command" | null {
	if (sessionGrants.some((g) => domainMatches(host, g))) return "session";
	if (commandGrants?.has(host)) return "command";
	return null;
}

/** Display subject: host, plus a non-default port when the proxy reports one. */
function subjectOf(host: string, port: number | undefined): string {
	return port && port !== 443 && port !== 80 ? `${host}:${port}` : host;
}

async function decide(deps: NetworkAskDeps, host: string, port: number | undefined): Promise<boolean> {
	const subject = subjectOf(host, port);
	const base = { layer: 1, tool: "network", subject, cwd: deps.cwd, note: "network-ask" };
	const ctx = deps.getCtx();
	if (!ctx || ctx.hasUI === false || !ctx.ui?.select) {
		deps.audit({ ...base, decision: "no", note: "network-ask-headless" });
		return false;
	}

	const kind: AskKind = {
		layer: 1,
		tool: "network",
		subject,
		reason: `domain not in allowlist: ${host}`,
		overrideKind: "allowDomains",
		overrideValue: host,
	};
	let decision;
	try {
		decision = await askDecision(ctx, kind, null);
	} catch {
		decision = "no" as const;
	}

	if (decision === "no") {
		deps.audit({ ...base, decision: "no" });
		return false;
	}
	if (decision === "yes") {
		commandGrants?.add(host);
		deps.audit({ ...base, decision: "yes" });
		return true;
	}
	if (decision === "session" || decision === "session-folder") {
		sessionGrants.push(host);
		deps.audit({ ...base, decision: "session", grant: host });
		ctx.ui.notify?.(`pi-sandbox: allowed for this session (not saved) → ${host}`, "info");
		return true;
	}

	// always-* / always-*-folder (network never returns folder variants today).
	const scope = decision === "always-global" || decision === "always-global-folder" ? "global" : "cwd";
	try {
		const path = await deps.persist(host, scope);
		deps.applyLive(host);
		deps.audit({ ...base, decision: scope === "cwd" ? "always-cwd" : "always-global", scope, persisted_to: path });
		ctx.ui.notify?.(`pi-sandbox: persisted ${scope} override → ${path}`, "warning");
	} catch (e) {
		// Mirror Layer 2: a failed write still allows the call, covering the
		// whole command so a redirect cannot loop the prompt.
		commandGrants?.add(host);
		deps.audit({ ...base, decision: "yes", note: `always-persist-failed: ${e}`, scope });
		ctx.ui.notify?.(`pi-sandbox: could not persist ${scope} override (${e}); allowing this command only`, "warning");
	}
	return true;
}

/**
 * Build the `SandboxAskCallback` for `SandboxManager.initialize`. One asker
 * per sandbox start; the session and command grants it consults are shared, so
 * a reload keeps them.
 */
export function createNetworkAsk(deps: NetworkAskDeps): (params: { host: string; port?: number }) => Promise<boolean> {
	return async ({ host, port }) => {
		const key = host.toLowerCase();
		const hit = granted(key);
		if (hit) {
			deps.audit({ layer: 1, tool: "network", subject: subjectOf(key, port), cwd: deps.cwd, decision: hit === "session" ? "session-grant" : "yes", note: `${hit}-grant` });
			return true;
		}
		const inflight = pending.get(key);
		if (inflight) return inflight;
		const decision = decide(deps, key, port).finally(() => pending.delete(key));
		pending.set(key, decision);
		return decision;
	};
}
