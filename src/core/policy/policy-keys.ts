export const POLICY_KEYS: Record<string, readonly string[]> = {
	"": [
		"$schema",
		"enabled",
		"mode",
		"network",
		"filesystem",
		"mcp",
		"subagent",
		"commands",
		"overrides",
		"ignoreViolations",
		"enableWeakerNestedSandbox",
	],
	network: [
		"allowedDomains",
		"deniedDomains",
		"allowLocalhost",
		"allowAllUnixSockets",
		"allowLocalBinding",
		"bridgeHostPorts",
		"strictAllowlist",
	],
	filesystem: [
		"denyRead",
		"modelDenyRead",
		"askRead",
		"allowRead",
		"allowWrite",
		"denyWrite",
		"askWrite",
		"disabled",
		"outsideProject",
	],
	"filesystem.outsideProject": ["read", "allowRead"],
	mcp: ["allowTools", "allowPrefixes", "askTools", "trustAnnotations", "allowSimpleUpdates", "askThreshold"],
	subagent: ["network"],
	commands: ["ask"],
	overrides: ["allowRead", "allowWrite", "allowDomains"],
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const reportedPaths = new Set<string>();

export function reportUnknownPolicyKeys(policyFilePath: string, policy: Record<string, unknown>): void {
	const unknown = unknownPolicyKeys(policy);

	if (!unknown.length) return;

	const reportKey = `${policyFilePath}:${unknown.join(",")}`;

	if (reportedPaths.has(reportKey)) return;

	reportedPaths.add(reportKey);
	console.warn(`auto-permission-system: ${policyFilePath} has unknown keys (${unknown.join(", ")}); they are ignored`);
}

export function unknownPolicyKeys(policy: Record<string, unknown>): string[] {
	const unknown: string[] = [];

	const walk = (value: unknown, path: string): void => {
		if (!isPlainObject(value)) return;

		const declared = POLICY_KEYS[path];

		for (const [key, child] of Object.entries(value)) {
			if (key.startsWith("_")) continue;

			if (declared && !declared.includes(key)) unknown.push(path ? `${path}.${key}` : key);

			walk(child, path ? `${path}.${key}` : key);
		}
	};

	walk(policy, "");

	return unknown;
}
