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
 *
 * Session grants use the parent-domain wildcard when useful (covers all sibling
 * subdomains). Screen 2 hides the "in this project" rows in untrusted
 * projects so the user can't quietly trust a widening file.
 */

import { domainMatches } from "../core/index";
import { askMain, askRememberHost, ASK_TIMEOUT_MS, parentDomainWildcard, type AskCtx, type MainChoice } from "../ui/ask-flow";

/** In-memory session grants ("Yes, for this session"). Cleared at session_start. */
const sessionGrants: string[] = [];
/** Hosts allowed for the current bash command ("Yes, just this once" covers its connections). */
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
	/** True when the cwd's project sandbox.json isn't trusted (ADR-013). */
	projectTrusted?: boolean;
	/** The bash command that triggered the proxy ask (shown in the body as `Command`). */
	command?: string;
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

/** First whitespace-separated word of a bash command \u2014 used to name the binary in the title. */
function firstWord(command: string | undefined): string | null {
	if (!command) return null;
	const w = command.trim().split(/\s+/)[0] ?? "";
	// Strip common prefixes.
	return w.replace(/^sudo$/, "").replace(/^command$/, "").replace(/^\\\//, "") || null;
}

async function decide(deps: NetworkAskDeps, host: string, port: number | undefined): Promise<boolean> {
	const subject = subjectOf(host, port);
	const base = { layer: 1, tool: "network", subject, cwd: deps.cwd, note: "network-ask" };
	const ctx = deps.getCtx();
	if (!ctx || ctx.hasUI === false || !ctx.ui?.select) {
		deps.audit({ ...base, decision: "no", note: "network-ask-headless" });
		return false;
	}

	const wild = parentDomainWildcard(host);
	const verb = firstWord(deps.command) ?? "this command";
	const header = `Let ${verb} connect to ${host}?`;
	const bodyParts: string[] = [];
	bodyParts.push(`Site     ${host}`);
	if (wild !== host.toLowerCase()) {
		const bare = wild.replace(/^\*\./, "");
		bodyParts.push(`Group    ${wild}   (every ${bare} site)`);
	}
	if (deps.command) bodyParts.push(`Command  ${deps.command}`);
	bodyParts.push(`Why      this site isn't on your allowed list yet`);

	let mainChoice: MainChoice;
	try {
		mainChoice = await askMain(ctx, header, bodyParts.join("\n"), {
			session: true,
			sessionLabel: "Yes, all in group for this session",
			allowFirst: true,
			icon: "net",
			timeoutMs: ASK_TIMEOUT_MS,
		});
	} catch {
		deps.audit({ ...base, decision: "no", note: "screen1-threw" });
		return false;
	}

	if (mainChoice === "block") {
		deps.audit({ ...base, decision: "no" });
		return false;
	}
	if (mainChoice === "once") {
		commandGrants?.add(host);
		deps.audit({ ...base, decision: "yes" });
		return true;
	}
	if (mainChoice === "session") {
		// ADR-030: session grant uses the parent-domain wildcard (e.g. *.composio.dev)
		// when the host has a useful parent, so any sibling subdomain is also covered
		// for the rest of the session without re-prompting. Apex hosts (2 parts)
		// fall back to the exact host since `*.example.com` would not match `example.com`.
		const grant = wild;
		sessionGrants.push(grant);
		deps.audit({ ...base, decision: "session", grant, requested: host });
		ctx.ui.notify?.(`pi-sandbox: allowed for this session (not saved) \u2192 ${grant}`, "info");
		return true;
	}

	// mainChoice === "remember" \u2014 screen 2 picks the wildcard or exact host pattern.
	const title = "Always allow connecting \u2014 what, and where?";
	const body: string[] = [];
	body.push(`Site     ${host}`);
	if (wild !== host.toLowerCase()) {
		const bare = wild.replace(/^\*\./, "");
		body.push(`Group    ${wild}   (every ${bare} site)`);
	}
	body.push(`Note     the rule works for any command, not just ${verb}`);
	if (deps.projectTrusted === false) {
		body.push(`Note     this project isn't trusted \u2014 run /security trust to save rules here`);
	}
	const picked = await askRememberHost(ctx, title, body.join("\n"), host, { icon: "save", untrusted: deps.projectTrusted === false });
	if (!picked) {
		deps.audit({ ...base, decision: "no", note: "remember-screen-cancelled" });
		return false;
	}
	const scope = picked.scope;
	const pattern = picked.pattern;
	try {
		const path = await deps.persist(pattern, scope);
		deps.applyLive(pattern);
		deps.audit({ ...base, decision: scope === "cwd" ? "always-cwd" : "always-global", scope, persisted_to: path, pattern, requested: host });
		ctx.ui.notify?.(`pi-sandbox: persisted ${scope} override \u2192 ${path}`, "warning");
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