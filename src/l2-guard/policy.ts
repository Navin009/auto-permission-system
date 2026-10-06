/**
 * Layer 2 policy: shape, defaults, loading, and project trust (ADR-013).
 *
 * Adapter module: uses pi (`getAgentDir`) but no UI and no event wiring.
 */

import { existsSync, readFileSync } from "node:fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { applyUntrustedProject, describeLoosening, isProjectFileTrusted, DEFAULT_ALLOW_WRITE, DEFAULT_DENY_READ, DEFAULT_DENY_WRITE } from "../core/index";

export interface Policy {
	enabled: boolean;
	network: { allowedDomains: string[]; deniedDomains: string[] };
	filesystem: {
		denyRead: string[];
		/** Layer 2 ONLY. Files the model's read tool may not access, but subprocesses can (so tools like gh keep working). */
		modelDenyRead?: string[];
		allowWrite: string[];
		denyWrite: string[];
		/**
		 * Reads outside the project directory (ADR-012). "allow" (default),
		 * "ask" or "deny". Never asked about: the project, allowWrite roots,
		 * pi's own package, and allowRead. `~/.pi/agent` is not exempt: it is in
		 * the default denyRead list (mcp.json can hold API keys).
		 */
		outsideProject?: { read?: "allow" | "ask" | "deny"; allowRead?: string[] };
	};
	/**
	 * Additive project-local overrides written by the "always for this cwd"
	 * branch of the ask-tier prompt. Never written from a global config.
	 */
	overrides?: {
		allowRead?: string[];
		allowWrite?: string[];
		allowDomains?: string[];
	};
	/**
	 * Layer 3 — stricter posture for headless pi (`ctx.hasUI === false`,
	 * which covers `-p`, JSON mode, and most subagent transports).
	 * Default: "allow" (no behavior change). Set to "deny" or "research-only"
	 * to opt in.
	 */
	subagent?: { network?: "allow" | "deny" | "research-only" };
}

// Keep in sync with sandbox/index.ts DEFAULT_CONFIG.
const DEFAULT_POLICY: Policy = {
	enabled: true,
	network: {
		allowedDomains: [
			"npmjs.org", "*.npmjs.org",
			"registry.npmjs.org", "registry.yarnpkg.com",
			"pypi.org", "*.pypi.org",
			"github.com", "*.github.com",
			"api.github.com", "raw.githubusercontent.com",
		],
		deniedDomains: [],
	},
	filesystem: {
		denyRead: [...DEFAULT_DENY_READ],
		allowWrite: [...DEFAULT_ALLOW_WRITE],
		denyWrite: [...DEFAULT_DENY_WRITE],
	},
	subagent: { network: "allow" },
};

export const TRUST_STORE = `${getAgentDir()}/extensions/sandbox.trust.json`;

/** Set at session_start: the user declined pi's own project-trust prompt. */
let piDeclinedTrust = false;

export function setPiDeclinedTrust(declined: boolean): void {
	piDeclinedTrust = declined;
}

export const projectPolicyPath = (cwd: string) => `${cwd}/.pi/sandbox.json`;

/** A project sandbox.json applies in full only when its content was trusted (ADR-013). */
export function projectTrusted(cwd: string): boolean {
	return !piDeclinedTrust && isProjectFileTrusted(projectPolicyPath(cwd), TRUST_STORE);
}

/** What an untrusted project file tries to make weaker, in plain sentences. Empty when trusted or deny-only. */
export function untrustedProjectChanges(cwd: string): string[] {
	const p = projectPolicyPath(cwd);
	if (!existsSync(p) || projectTrusted(cwd)) return [];
	try {
		return describeLoosening(JSON.parse(readFileSync(p, "utf-8")));
	} catch {
		return [];
	}
}

export const bullets = (xs: string[]) => xs.map((x) => `  • ${x}`).join("\n");

export function loadPolicy(cwd: string): Policy {
	const paths = [
		`${getAgentDir()}/extensions/sandbox.json`,
		projectPolicyPath(cwd),
	];
	let policy: Policy = structuredClone(DEFAULT_POLICY);
	for (const p of paths) {
		if (!existsSync(p)) continue;
		try {
			const o = JSON.parse(readFileSync(p, "utf-8"));
			// An untrusted project file may only tighten: deny lists are added,
			// stricter postures win, anything that could loosen is ignored.
			if (p === projectPolicyPath(cwd) && !projectTrusted(cwd)) {
				const policyRec = /* SAFETY: Policy is parsed JSON, readable as a plain record. */ policy as unknown as Record<string, unknown>;
				policy = /* SAFETY: applyUntrustedProject returns the same shape it was handed. */ applyUntrustedProject(policyRec, o).merged as unknown as Policy;
				continue;
			}
			if (o.enabled !== undefined) policy.enabled = o.enabled;
			if (o.network) policy.network = { ...policy.network, ...o.network };
			if (o.filesystem) policy.filesystem = { ...policy.filesystem, ...o.filesystem };
			if (o.subagent) policy.subagent = { ...policy.subagent, ...o.subagent };
			if (o.overrides) {
				policy.overrides = {
					allowRead: [...(policy.overrides?.allowRead ?? []), ...(o.overrides.allowRead ?? [])],
					allowWrite: [...(policy.overrides?.allowWrite ?? []), ...(o.overrides.allowWrite ?? [])],
					allowDomains: [...(policy.overrides?.allowDomains ?? []), ...(o.overrides.allowDomains ?? [])],
				};
			}
		} catch (e) {
			console.error(`security-guard: failed to parse ${p}: ${e}`);
		}
	}
	return policy;
}
