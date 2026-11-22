import { homedir } from "node:os";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { DANGEROUS_FILES, DANGEROUS_DIRECTORIES } from "@anthropic-ai/sandbox-runtime/dist/sandbox/sandbox-utils.js";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	addOverride,
	addProjectOverride,
	globalPolicyPath,
	projectPolicyPath,
	sandboxFilesystem,
	GrantScope,
	OverrideKind,
} from "../core/index.ts";
import { loadConfig, projectTrusted, TRUST_STORE, type SandboxConfig } from "./config.ts";
import { audit } from "../shared/audit.ts";
import { createNetworkAsk, type NetworkAskDeps } from "./network-ask.ts";

const RETAINED_DANGEROUS_DIRECTORY = ".git";

export function suppressGhostDotfiles(): string | null {
	try {
		// SAFETY: sandbox-runtime keeps this list as a mutable string array at runtime, whatever its types declare.
		const files = DANGEROUS_FILES as unknown as string[] | undefined;
		// SAFETY: DANGEROUS_DIRECTORIES has the same runtime shape as DANGEROUS_FILES.
		const dirs = DANGEROUS_DIRECTORIES as unknown as string[] | undefined;

		if (!Array.isArray(files) || !Array.isArray(dirs)) {
			return "sandbox-runtime no longer exports DANGEROUS_FILES/DANGEROUS_DIRECTORIES as arrays";
		}

		files.length = 0;

		const retainedDirs = dirs.filter((directory) => directory === RETAINED_DANGEROUS_DIRECTORY);
		dirs.length = 0;
		dirs.push(...retainedDirs);

		if (files.length !== 0 || dirs.length !== retainedDirs.length) {
			return "sandbox-runtime exposure lists could not be rewritten";
		}

		return null;
	} catch (error) {
		return `sandbox-runtime exposure lists are unavailable (${error})`;
	}
}

const ghostDotfileProblem = suppressGhostDotfiles();

if (ghostDotfileProblem) {
	console.error(`auto-permission-system: ${ghostDotfileProblem}; dotfile mounts may create empty files in the project`);
}

type Layer1FilesystemKind = typeof OverrideKind.AllowWrite | typeof OverrideKind.AllowRead;

function runtimeConfig(cwd: string, config: SandboxConfig): SandboxRuntimeConfig {
	const allowLocalhost = config.allowLocalhost ?? config.network?.allowLocalhost ?? true;
	const allowAllUnixSockets = config.allowAllUnixSockets ?? config.network?.allowAllUnixSockets ?? true;
	const network = config.network
		? {
				...config.network,
				allowAllUnixSockets,
				allowLocalBinding: config.allowLocalBinding ?? config.network.allowLocalBinding ?? allowLocalhost,
			}
		: undefined;

	return {
		network: network as NonNullable<SandboxRuntimeConfig["network"]>,
		filesystem: config.filesystem
			? sandboxFilesystem(config.filesystem, { cwd, home: homedir() })
			: { denyRead: [], allowRead: [], allowWrite: [], denyWrite: [], disabled: true },
		ignoreViolations: config.ignoreViolations,
		enableWeakerNestedSandbox: config.enableWeakerNestedSandbox,
	};
}

export async function initSandbox(cwd: string, config: SandboxConfig, deps?: NetworkAskDeps): Promise<void> {
	suppressGhostDotfiles();
	await SandboxManager.initialize(runtimeConfig(cwd, config), deps ? createNetworkAsk(deps) : undefined);
}

export async function resetSandbox(): Promise<void> {
	try {
		await SandboxManager.reset();
	} catch (err) {
		void err;
	}
}

export async function reloadSandbox(cwd: string, deps?: NetworkAskDeps): Promise<void> {
	const config = loadConfig(cwd);
	await resetSandbox();
	await initSandbox(cwd, config, deps);
}

const GRANTABLE_HOST =
	/^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$|^\d{1,3}(\.\d{1,3}){3}$/;

export function isGrantableHost(host: string): boolean {
	return GRANTABLE_HOST.test(host.toLowerCase());
}

export function applyNetworkGrant(host: string): void {
	const pattern = host.toLowerCase();
	if (!isGrantableHost(pattern)) {
		audit({ layer: 1, event: "network-grant-refused", host: pattern, note: "not-a-hostname" });
		return;
	}

	const current = SandboxManager.getConfig();
	if (!current) return;

	if (current.network.deniedDomains.some((denied) => denied.toLowerCase() === pattern)) {
		audit({ layer: 1, event: "network-grant-refused", host: pattern, note: "denied-domain" });
		return;
	}

	if (current.network.allowedDomains.some((allowed) => allowed.toLowerCase() === pattern)) return;

	SandboxManager.updateConfig({
		...current,
		network: { ...current.network, allowedDomains: [...current.network.allowedDomains, pattern] },
	});

	audit({ layer: 1, event: "network-grant-live", host: pattern });
}

async function writeLayer1Override(cwd: string, kind: OverrideKind, value: string, scope: GrantScope): Promise<string> {
	const path = scope === GrantScope.Cwd ? projectPolicyPath(cwd) : globalPolicyPath(getAgentDir());
	if (scope === GrantScope.Cwd && !projectTrusted(cwd)) {
		throw new Error(`${path} is not trusted; run /security trust first, or choose an "ALL projects" option`);
	}
	return scope === GrantScope.Cwd ? addProjectOverride(path, TRUST_STORE, kind, value) : addOverride(path, kind, value);
}

export async function writeNetworkOverride(cwd: string, host: string, scope: GrantScope): Promise<string> {
	return writeLayer1Override(cwd, OverrideKind.AllowDomains, host, scope);
}

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
