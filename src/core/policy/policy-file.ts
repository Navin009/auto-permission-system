import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { normalizeMode, type PermissionMode } from "./mode.ts";

/** True when the path holds a policy file; a directory (or absent path) is not one. */
export function isPolicyFile(policyFilePath: string): boolean {
	try {
		return statSync(policyFilePath).isFile();
	} catch {
		return false;
	}
}

interface PolicyCacheEntry {
	key: string;
	policy: Record<string, unknown>;
}

const policyCache = new Map<string, PolicyCacheEntry>();

function cacheKeyOf(policyFilePath: string): string {
	try {
		const stats = statSync(policyFilePath);
		return `${stats.mtimeMs}:${stats.size}`;
	} catch {
		return "absent";
	}
}

/** Parsed policy, cached by mtime and size; null when the path is not a parseable file. */
export function readPolicy(policyFilePath: string): Record<string, unknown> | null {
	if (!isPolicyFile(policyFilePath)) {
		return null;
	}

	const key = cacheKeyOf(policyFilePath);
	const cached = policyCache.get(policyFilePath);

	if (cached?.key === key) {
		return cached.policy;
	}

	try {
		const policy = JSON.parse(readFileSync(policyFilePath, "utf-8")) as Record<string, unknown>;
		policyCache.set(policyFilePath, { key, policy });

		return policy;
	} catch {
		return null;
	}
}

export function policyFileError(policyFilePath: string): string | null {
	if (!existsSync(policyFilePath)) {
		return null;
	}

	try {
		if (!statSync(policyFilePath).isFile()) {
			return `${policyFilePath} is not a file`;
		}

		JSON.parse(readFileSync(policyFilePath, "utf-8"));
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

export function readPolicyForUpdate(policyFilePath: string): Record<string, unknown> {
	if (!existsSync(policyFilePath)) {
		return {};
	}

	try {
		return JSON.parse(readFileSync(policyFilePath, "utf-8"));
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		throw new Error(`refusing to overwrite ${policyFilePath}: it does not parse as JSON (${errorMessage})`);
	}
}

/** Write through a sibling temp file and rename, so a reader never sees half a policy. */
export function writePolicyFile(policyFilePath: string, policy: Record<string, unknown>): void {
	mkdirSync(dirname(policyFilePath), { recursive: true });

	const temporaryPath = `${policyFilePath}.tmp`;
	writeFileSync(temporaryPath, `${JSON.stringify(policy, null, 2)}\n`);
	renameSync(temporaryPath, policyFilePath);

	policyCache.set(policyFilePath, { key: cacheKeyOf(policyFilePath), policy });
}

export function setPolicyMode(policyFilePath: string, mode: PermissionMode): void {
	const policy = readPolicyForUpdate(policyFilePath);
	policy.mode = normalizeMode(mode);

	writePolicyFile(policyFilePath, policy);
}
