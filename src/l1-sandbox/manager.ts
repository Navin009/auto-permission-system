/**
 * Layer 1 sandbox-runtime lifecycle: initialize, reset/reload, persist an
 * ask-tier "always" grant into sandbox.json, and apply network grants live.
 *
 * Adapter module: owns the SandboxManager singleton and the on-disk policy.
 */

import { homedir } from "node:os";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { addOverride, addProjectOverride, globalPolicyPath, projectPolicyPath, sandboxFilesystem, GrantScope, OverrideKind } from "../core/index";
import { loadConfig, projectTrusted, TRUST_STORE, type SandboxConfig } from "./config";
import { createNetworkAsk, type NetworkAskDeps } from "./network-ask";

/** The two override kinds Layer 1's filesystem asks can persist. */
type Layer1FilesystemKind = typeof OverrideKind.AllowWrite | typeof OverrideKind.AllowRead;

/**
 * The sandbox-runtime view of a SandboxConfig. pi-only fields (modelDenyRead,
 * `_comment_*`) are stripped so SandboxManager doesn't see keys it doesn't
 * understand; modelDenyRead is enforced by Layer 2 (security-guard.ts).
 * sandboxFilesystem() also adds the outside-project fence when
 * filesystem.outsideProject.read gates reads.
 */
function runtimeConfig(cwd: string, config: SandboxConfig): SandboxRuntimeConfig {
	return {
		network: config.network,
		filesystem: config.filesystem
			? sandboxFilesystem(config.filesystem, { cwd, home: homedir() })
			: { denyRead: [], allowRead: [], allowWrite: [], denyWrite: [], disabled: true },
		ignoreViolations: config.ignoreViolations,
		enableWeakerNestedSandbox: config.enableWeakerNestedSandbox,
	};
}

/**
 * `deps` registers the unknown-domain ask callback (ADR-023). Without it the
 * proxy hard-denies hosts outside `allowedDomains` (sandbox-runtime's own
 * behavior when no callback is registered).
 */
export async function initSandbox(cwd: string, config: SandboxConfig, deps?: NetworkAskDeps): Promise<void> {
	await SandboxManager.initialize(runtimeConfig(cwd, config), deps ? createNetworkAsk(deps) : undefined);
}

export async function resetSandbox(): Promise<void> {
	try {
		await SandboxManager.reset();
	} catch {
		/* ignore cleanup errors */
	}
}

export async function reloadSandbox(cwd: string, deps?: NetworkAskDeps): Promise<void> {
	const config = loadConfig(cwd);
	await resetSandbox();
	await initSandbox(cwd, config, deps);
}

/**
 * Add a host to the running proxy's allowlist in place. `updateConfig` swaps
 * the config the proxy reads per request; a `reset()`/`initialize()` here
 * would tear down the proxy that is serving the request being approved.
 */
export function applyNetworkGrant(host: string): void {
	const current = SandboxManager.getConfig();
	if (!current) return;
	const pattern = host.toLowerCase();
	if (current.network.allowedDomains.some((allowed) => allowed.toLowerCase() === pattern)) return;
	SandboxManager.updateConfig({
		...current,
		network: { ...current.network, allowedDomains: [...current.network.allowedDomains, pattern] },
	});
}

/**
 * File write only — the caller decides whether (and how) to apply it live.
 *
 * Never writes a grant into an untrusted project file: recording the new hash
 * would trust whatever else is in it.
 */
async function writeLayer1Override(
	cwd: string,
	kind: OverrideKind,
	value: string,
	scope: GrantScope,
): Promise<string> {
	const path = scope === GrantScope.Cwd ? projectPolicyPath(cwd) : globalPolicyPath(getAgentDir());
	if (scope === GrantScope.Cwd && !projectTrusted(cwd)) {
		throw new Error(`${path} is not trusted; run /security trust first, or choose an "ALL projects" option`);
	}
	return scope === GrantScope.Cwd ? addProjectOverride(path, TRUST_STORE, kind, value) : addOverride(path, kind, value);
}

/**
 * Write an "always" domain grant (file only). The network ask applies it live
 * with `applyNetworkGrant` right after, so the in-flight request survives.
 */
export async function writeNetworkOverride(cwd: string, host: string, scope: GrantScope): Promise<string> {
	return writeLayer1Override(cwd, OverrideKind.AllowDomains, host, scope);
}

/** Persist an "always" Layer 1 override (scope: cwd or global) and live-reload SandboxManager. */
export async function persistLayer1Override(
	cwd: string,
	kind: Layer1FilesystemKind,
	absPath: string,
	scope: GrantScope,
	deps?: NetworkAskDeps,
): Promise<string> {
	const path = await writeLayer1Override(cwd, kind, absPath, scope);
	await reloadSandbox(cwd, deps);
	return path;
}
