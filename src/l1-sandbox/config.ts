/**
 * Layer 1 policy loading. Reads the global + project sandbox.json, applies the
 * untrusted-project tightening (ADR-013), and folds the ask-tier `overrides`
 * into a flat sandbox-runtime config.
 *
 * Adapter module: uses pi (`getAgentDir`) but no UI and no sandbox process.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { applyUntrustedProject, isProjectFileTrusted, loadDefaultPolicy, overlayPolicy, normalizeMode, DEFAULT_DENY_READ, DEFAULT_DENY_WRITE, DEFAULT_ALLOW_WRITE, DEFAULT_MODE, type PermissionMode } from "../core/index";

export interface SandboxFilesystem extends NonNullable<SandboxRuntimeConfig["filesystem"]> {
	/** Layer 2 ONLY (model tools); kept here so both layers share one config shape. */
	modelDenyRead?: string[];
	/** Paths that prompt on read instead of being hard-denied (ADR-019). Layer 1 asks in the bash pre-flight. */
	askRead?: string[];
	/** Reads outside the project (ADR-012). Layer 1 enforces it via sandboxFilesystem(). */
	outsideProject?: { read?: "allow" | "ask" | "deny"; allowRead?: string[] };
}

export interface SandboxConfig extends Omit<SandboxRuntimeConfig, "filesystem"> {
	enabled?: boolean;
	/** `default` = rules only; `advanced-secure` adds secret/credential detection (ADR-018). */
	mode?: PermissionMode;
	filesystem?: SandboxFilesystem;
	/**
	 * Additive project-local overrides written by the ask-tier prompts (Layer 1
	 * writes allowWrite/allowRead; Layer 2 shares the same file). Read by
	 * loadConfig() and folded into filesystem.allowWrite / allowRead /
	 * network.allowedDomains so the OS-level sandbox honors them.
	 */
	overrides?: {
		allowRead?: string[];
		allowWrite?: string[];
		allowDomains?: string[];
	};
	/** Commands/paths that can print secrets (env, proc environ) and must ask first. */
	commands?: { ask?: string[] };
}

const BUILTIN_CONFIG: SandboxConfig = {
	enabled: true,
	mode: DEFAULT_MODE,
	network: {
		allowedDomains: [
			"npmjs.org",
			"*.npmjs.org",
			"registry.npmjs.org",
			"registry.yarnpkg.com",
			"pypi.org",
			"*.pypi.org",
			"github.com",
			"*.github.com",
			"api.github.com",
			"raw.githubusercontent.com",
		],
		deniedDomains: [],
	},
	filesystem: {
		denyRead: [...DEFAULT_DENY_READ],
		allowWrite: [...DEFAULT_ALLOW_WRITE],
		denyWrite: [...DEFAULT_DENY_WRITE],
	},
};

/** Baseline = the shipped sandbox.default.json layered over the built-in constants. */
const DEFAULT_CONFIG: SandboxConfig = overlayPolicy(BUILTIN_CONFIG, (loadDefaultPolicy() ?? {}) as Partial<SandboxConfig>);

export const TRUST_STORE = join(getAgentDir(), "extensions", "sandbox.trust.json");

/** Set at session_start: the user declined pi's own project-trust prompt. */
let piDeclinedTrust = false;

export function setPiDeclinedTrust(declined: boolean): void {
	piDeclinedTrust = declined;
}

/** A project sandbox.json applies in full only when its content was trusted (ADR-013). */
export function projectTrusted(cwd: string): boolean {
	return !piDeclinedTrust && isProjectFileTrusted(join(cwd, ".pi", "sandbox.json"), TRUST_STORE);
}

export function loadConfig(cwd: string): SandboxConfig {
	const projectConfigPath = join(cwd, ".pi", "sandbox.json");
	const globalConfigPath = join(getAgentDir(), "extensions", "sandbox.json");

	let globalConfig: Partial<SandboxConfig> = {};
	let projectConfig: Partial<SandboxConfig> = {};

	if (existsSync(globalConfigPath)) {
		try {
			globalConfig = JSON.parse(readFileSync(globalConfigPath, "utf-8"));
		} catch (e) {
			console.error(`Warning: Could not parse ${globalConfigPath}: ${e}`);
		}
	}

	if (existsSync(projectConfigPath)) {
		try {
			projectConfig = JSON.parse(readFileSync(projectConfigPath, "utf-8"));
		} catch (e) {
			console.error(`Warning: Could not parse ${projectConfigPath}: ${e}`);
		}
	}

	const base = overlayPolicy(DEFAULT_CONFIG, globalConfig);
	// An untrusted project file may only tighten the sandbox: no enabled:false,
	// no allowWrite / allowedDomains / overrides, no ignoreViolations or
	// enableWeakerNestedSandbox, and its deny lists are added, not substituted.
	let merged: SandboxConfig;
	if (existsSync(projectConfigPath) && !projectTrusted(cwd)) {
		const baseRec = /* SAFETY: SandboxConfig is parsed JSON, readable as a plain record. */ base as unknown as Record<string, unknown>;
		const projectRec = /* SAFETY: project sandbox.json is parsed JSON. */ projectConfig as unknown as Record<string, unknown>;
		merged = /* SAFETY: applyUntrustedProject returns the same shape it was handed. */ applyUntrustedProject(baseRec, projectRec).merged as unknown as SandboxConfig;
	} else {
		merged = overlayPolicy(base, projectConfig);
	}
	return { ...foldOverrides(merged), mode: normalizeMode(merged.mode) };
}

/**
 * Fold an additive `overrides` section into the regular allowWrite /
 * allowedDomains arrays so SandboxManager (which doesn't know about
 * `overrides`) sees a flat config. Idempotent.
 */
function foldOverrides(config: SandboxConfig): SandboxConfig {
	const overrides = config.overrides;
	if (!overrides) return config;
	const out: SandboxConfig = {
		...config,
		filesystem: config.filesystem
			? { ...config.filesystem }
			: { denyRead: [], allowWrite: [], denyWrite: [] },
		network: config.network ? { ...config.network } : { allowedDomains: [], deniedDomains: [] },
	};
	if (overrides.allowWrite?.length) {
		out.filesystem!.allowWrite = [
			...(out.filesystem!.allowWrite ?? []),
			...overrides.allowWrite,
		];
	}
	// Fold read grants too: an ask-tier "always" for an outside bash read
	// re-exposes it via filesystem.allowRead (ADR-014). This cannot unmask a
	// secret: the absolute-deny tier refuses "always" for credentials, and
	// sandbox-runtime keeps explicit file denies winning over a directory
	// allowRead.
	if (overrides.allowRead?.length) {
		out.filesystem!.allowRead = [
			...(out.filesystem!.allowRead ?? []),
			...overrides.allowRead,
		];
	}
	if (overrides.allowDomains?.length) {
		out.network!.allowedDomains = [
			...(out.network!.allowedDomains ?? []),
			...overrides.allowDomains,
		];
	}
	return out;
}

// Layering lives in src/core/policy/merge.ts (overlayPolicy) so both layers share it.

