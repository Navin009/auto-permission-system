import { readPolicyForUpdate, writePolicyFile } from "./policy-file.ts";
import { recordProjectTrust } from "../trust.ts";

export const OverrideKind = {
	AllowRead: "allowRead",
	AllowWrite: "allowWrite",
	AllowDomains: "allowDomains",
} as const;

export type OverrideKind = (typeof OverrideKind)[keyof typeof OverrideKind];

export const GrantScope = {
	Cwd: "cwd",
	Global: "global",
} as const;

export type GrantScope = (typeof GrantScope)[keyof typeof GrantScope];

type OverrideLists = Partial<Record<OverrideKind, string[]>>;

export function addOverride(policyFilePath: string, kind: OverrideKind, overrideValue: string): string {
	const existingPolicy = readPolicyForUpdate(policyFilePath) as { overrides?: OverrideLists };
	const overrides = existingPolicy.overrides ?? {};
	const overrideList = overrides[kind] ?? [];

	if (!overrideList.includes(overrideValue)) {
		overrideList.push(overrideValue);
	}

	overrides[kind] = overrideList;
	existingPolicy.overrides = overrides;

	writePolicyFile(policyFilePath, existingPolicy);

	return policyFilePath;
}

export function addProjectOverride(
	projectPolicyFilePath: string,
	trustStorePath: string,
	kind: OverrideKind,
	overrideValue: string,
): string {
	const savedPath = addOverride(projectPolicyFilePath, kind, overrideValue);

	recordProjectTrust(projectPolicyFilePath, trustStorePath);

	return savedPath;
}
