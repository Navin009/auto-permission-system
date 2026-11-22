/** Every key the policy readers understand, by dotted path. The schema must agree. */
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

/**
 * Keys the readers will ignore. A typo such as `allowWrites` or a top-level
 * `allowWrite` used to be silent, so the policy looked configured and was not.
 */
const reportedPaths = new Set<string>();

/** Warn once per file and key set, so a per-tool-call load cannot spam the console. */
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
