import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

export function setPolicyMode(policyFilePath: string, mode: PermissionMode): void {
	const policy = readPolicyForUpdate(policyFilePath);
	policy.mode = normalizeMode(mode);

	mkdirSync(dirname(policyFilePath), { recursive: true });
	writeFileSync(policyFilePath, `${JSON.stringify(policy, null, 2)}\n`);
}
