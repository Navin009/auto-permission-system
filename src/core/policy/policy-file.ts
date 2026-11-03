import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { normalizeMode, type PermissionMode } from "./mode.ts";

export function policyFileError(policyFilePath: string): string | null {
	if (!existsSync(policyFilePath)) {
		return null;
	}

	try {
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
