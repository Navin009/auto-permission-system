/**
 * Layer 2 policy: shape, defaults, loading, and project trust (ADR-013).
 *
 * Adapter module: uses pi (`getAgentDir`) but no UI and no event wiring.
 */

import { existsSync, readFileSync } from "node:fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { applyUntrustedProject, createProjectTrust, describeLoosening, loadDefaultPolicy, overlayPolicy, normalizeMode, DEFAULT_ALLOW_WRITE, DEFAULT_DENY_READ, DEFAULT_DENY_WRITE, DEFAULT_MODE, BUILTIN_NETWORK_ALLOWED, projectPolicyPath, trustStorePath, type PermissionMode } from "../core/index";
import type { McpPolicy } from "../detect";

export interface Policy {
	enabled: boolean;
	/** `default` = rules only; `advanced-secure` adds secret/credential detection (ADR-018). */
	mode?: PermissionMode;
	network: { allowedDomains: string[]; deniedDomains: string[] };
	filesystem: {
		denyRead: string[];
		/** Layer 2 ONLY. Files the model's read tool may not access, but subprocesses can (so tools like gh keep working). */
		modelDenyRead?: string[];
		allowWrite: string[];
		denyWrite: string[];
		/** Paths that prompt on read instead of being hard-denied (ADR-019). */
		askRead?: string[];
		/**
		 * Reads outside the project directory (ADR-012). "allow" (default),
		 * "ask" or "deny". Never asked about: the project, allowWrite roots,
		 * pi's own package, and allowRead. `~/.pi/agent` is not exempt: it is in
		 * the default denyRead list (mcp.json can hold API keys).
		 */
		outsideProject?: { read?: "allow" | "ask" | "deny"; allowRead?: string[] };
	};
	mcp?: McpPolicy;
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

const BUILTIN_POLICY: Policy = {
	enabled: true,
	mode: DEFAULT_MODE,
	network: {
		allowedDomains: [...BUILTIN_NETWORK_ALLOWED],
		deniedDomains: [],
	},
	filesystem: {
		denyRead: [...DEFAULT_DENY_READ],
		allowWrite: [...DEFAULT_ALLOW_WRITE],
		denyWrite: [...DEFAULT_DENY_WRITE],
	},
	subagent: { network: "allow" },
};

/** Baseline = the shipped sandbox.default.json layered over the built-in constants. */
const DEFAULT_POLICY: Policy = overlayPolicy(BUILTIN_POLICY, (loadDefaultPolicy() ?? {}) as Partial<Policy>);

export const TRUST_STORE = `${getAgentDir()}/extensions/sandbox.trust.json`;

/** Set at session_start: the user declined pi's own project-trust prompt. */
const projectTrust = createProjectTrust(TRUST_STORE);

export function setPiDeclinedTrust(declined: boolean): void {
	projectTrust.setDeclined(declined);
}

export { projectPolicyPath };

/** A project sandbox.json applies in full only when its content was trusted (ADR-013). */
export function projectTrusted(cwd: string): boolean {
	return projectTrust.isTrusted(cwd);
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
			policy = overlayPolicy(policy, o as Partial<Policy>);
		} catch (e) {
			console.error(`security-guard: failed to parse ${p}: ${e}`);
		}
	}
	return { ...policy, mode: normalizeMode(policy.mode) };
}
