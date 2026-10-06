/**
 * Layer 1 sandbox-runtime lifecycle: initialize, reset/reload, and persist an
 * ask-tier "always" grant into sandbox.json.
 *
 * Adapter module: owns the SandboxManager singleton and the on-disk policy.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readPolicyForUpdate, recordProjectTrust, sandboxFilesystem } from "../core/index";
import { loadConfig, projectTrusted, TRUST_STORE, type SandboxConfig } from "./config";

export async function initSandbox(cwd: string, config: SandboxConfig): Promise<void> {
	await SandboxManager.initialize({
		network: config.network,
		// Strip pi-only fields (modelDenyRead, _comment_*) so SandboxManager
		// doesn't see keys it doesn't understand; modelDenyRead is enforced by
		// Layer 2 (security-guard.ts). sandboxFilesystem() also adds the
		// outside-project fence when filesystem.outsideProject.read gates reads.
		filesystem: config.filesystem
			? sandboxFilesystem(config.filesystem, { cwd, home: homedir() })
			: { denyRead: [], allowRead: [], allowWrite: [], denyWrite: [], disabled: true },
		ignoreViolations: config.ignoreViolations,
		enableWeakerNestedSandbox: config.enableWeakerNestedSandbox,
	});
}

export async function resetSandbox(): Promise<void> {
	try {
		await SandboxManager.reset();
	} catch {
		/* ignore cleanup errors */
	}
}

export async function reloadSandbox(cwd: string): Promise<void> {
	const config = loadConfig(cwd);
	await resetSandbox();
	await initSandbox(cwd, config);
}

/** Persist an "always" Layer 1 override (scope: cwd or global) and live-reload SandboxManager. */
export async function persistLayer1Override(
	cwd: string,
	kind: "allowWrite" | "allowRead",
	absPath: string,
	scope: "cwd" | "global",
): Promise<string> {
	const { dir, path } =
		scope === "cwd"
			? { dir: join(cwd, ".pi"), path: join(cwd, ".pi", "sandbox.json") }
			: { dir: join(getAgentDir(), "extensions"), path: join(getAgentDir(), "extensions", "sandbox.json") };
	// Never write a grant into an untrusted project file: recording the new hash
	// would trust whatever else is in it.
	if (scope === "cwd" && !projectTrusted(cwd)) {
		throw new Error(`${path} is not trusted; run /security trust first, or choose an "ALL projects" option`);
	}
	// Throws on an unparseable file: never overwrite a hand-written policy we could not read.
	const existing = readPolicyForUpdate(path) as { overrides?: { allowWrite?: string[]; allowRead?: string[] } };
	const overrides = existing.overrides ?? {};
	const list = overrides[kind] ?? [];
	if (!list.includes(absPath)) list.push(absPath);
	overrides[kind] = list;
	existing.overrides = overrides;
	mkdirSync(dir, { recursive: true });
	writeFileSync(path, `${JSON.stringify(existing, null, 2)}\n`);
	if (scope === "cwd") recordProjectTrust(path, TRUST_STORE);
	await reloadSandbox(cwd);
	return path;
}
