/**
 * Layer 2 policy: shape, defaults, loading, and project trust (ADR-013).
 *
 * Adapter module: uses pi (`getAgentDir`) but no UI and no event wiring.
 */

import { existsSync, readFileSync } from "node:fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { applyUntrustedProject, createProjectTrust, describeLoosening, shippedPolicy, overlayPolicy, normalizeMode, ReadPosture, SubagentNetwork, globalPolicyPath, projectPolicyPath, trustStorePath, type PermissionMode } from "../core/index";
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
		/** Roots that never ask on read, even when an askRead folder covers them (ADR-047). */
		allowRead?: string[];
		/** Paths that prompt on write; wins over allowWrite, loses to denyWrite (ADR-045). */
		askWrite?: string[];
		/**
		 * Reads outside the project directory (ADR-012). `allow` (default),
		 * `ask` or `deny`. Never asked about: the project, allowWrite roots,
		 * pi's own package, and allowRead. `~/.pi/agent` is not exempt: it is in
		 * the default denyRead list (mcp.json can hold API keys).
		 */
		outsideProject?: { read?: ReadPosture; allowRead?: string[] };
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
	 * Default: `allow` (no behavior change). Set to `deny` or `research-only`
	 * to opt in.
	 */
	subagent?: { network?: SubagentNetwork };
}

/** Baseline = the shipped `sandbox.default.json`, the one place default lists live. */
/* SAFETY: shippedPolicy() is parsed JSON plus the closed shape, which carries exactly the keys Policy reads. */
const DEFAULT_POLICY: Policy = shippedPolicy() as unknown as Policy;

export const TRUST_STORE = trustStorePath(getAgentDir());

const projectTrust = createProjectTrust(TRUST_STORE);

/** Set at session_start: the user declined pi's own project-trust prompt. */
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
	const projectPath = projectPolicyPath(cwd);
	if (!existsSync(projectPath) || projectTrusted(cwd)) return [];
	try {
		return describeLoosening(JSON.parse(readFileSync(projectPath, "utf-8")));
	} catch {
		return [];
	}
}

export const bullets = (changes: string[]): string => changes.map((change) => `  • ${change}`).join("\n");

/**
 * Load the global policy, then the project policy on top.
 *
 * An untrusted project file may only tighten: its deny lists are added,
 * stricter postures win, and anything that could loosen is ignored.
 */
export function loadPolicy(cwd: string): Policy {
	const policyPaths = [globalPolicyPath(getAgentDir()), projectPolicyPath(cwd)];
	let policy: Policy = structuredClone(DEFAULT_POLICY);
	for (const path of policyPaths) {
		if (!existsSync(path)) continue;
		try {
			const parsed = JSON.parse(readFileSync(path, "utf-8"));
			if (path === projectPolicyPath(cwd) && !projectTrusted(cwd)) {
				const policyRecord = /* SAFETY: Policy is parsed JSON, readable as a plain record. */ policy as unknown as Record<string, unknown>;
				policy = /* SAFETY: applyUntrustedProject returns the same shape it was handed. */ applyUntrustedProject(policyRecord, parsed).merged as unknown as Policy;
				continue;
			}
			policy = overlayPolicy(policy, parsed as Partial<Policy>);
		} catch (error) {
			console.error(`security-guard: failed to parse ${path}: ${error}`);
		}
	}
	return { ...policy, mode: normalizeMode(policy.mode) };
}
