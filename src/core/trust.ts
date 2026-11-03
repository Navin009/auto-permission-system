import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { MODE_ORDER, PermissionMode } from "./policy/mode.ts";
import { projectPolicyPath } from "./policy/paths.ts";
import { ReadPosture } from "./policy/classify.ts";
import { SubagentNetwork } from "./policy/subagent.ts";

interface TrustStore {
	trusted: Record<string, string>;
	declined: Record<string, string>;
}

export function fileHash(filePath: string): string | null {
	if (!existsSync(filePath)) {
		return null;
	}

	return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function readStore(storePath: string): TrustStore {
	const createEmptyStore = (): TrustStore => ({ trusted: {}, declined: {} });

	if (!existsSync(storePath)) {
		return createEmptyStore();
	}

	try {
		const parsed = JSON.parse(readFileSync(storePath, "utf-8")) as Partial<TrustStore>;
		return {
			trusted: { ...(parsed?.trusted ?? {}) },
			declined: { ...(parsed?.declined ?? {}) },
		};
	} catch {
		return createEmptyStore();
	}
}

function writeStore(storePath: string, store: TrustStore): void {
	mkdirSync(dirname(storePath), { recursive: true });
	writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`);
}

export function isProjectFileTrusted(projectPath: string, storePath: string): boolean {
	const currentHash = fileHash(projectPath);

	if (currentHash === null) {
		return true;
	}

	return readStore(storePath).trusted[projectPath] === currentHash;
}

export function isProjectFileDeclined(projectPath: string, storePath: string): boolean {
	const currentHash = fileHash(projectPath);

	return currentHash !== null && readStore(storePath).declined[projectPath] === currentHash;
}

export interface ProjectTrust {
	setDeclined(isDeclined: boolean): void;
	isTrusted(workingDirectory: string): boolean;
}

export function createProjectTrust(storePath: string): ProjectTrust {
	let isDeclinedByUser = false;

	return {
		setDeclined(isDeclined: boolean): void {
			isDeclinedByUser = isDeclined;
		},
		isTrusted(workingDirectory: string): boolean {
			return !isDeclinedByUser && isProjectFileTrusted(projectPolicyPath(workingDirectory), storePath);
		},
	};
}

export function recordProjectDeclined(projectPath: string, storePath: string): void {
	const store = readStore(storePath);
	const currentHash = fileHash(projectPath);

	if (currentHash === null) {
		return;
	}

	store.declined[projectPath] = currentHash;
	delete store.trusted[projectPath];

	writeStore(storePath, store);
}

export function recordProjectTrust(projectPath: string, storePath: string): void {
	const store = readStore(storePath);
	const currentHash = fileHash(projectPath);

	if (currentHash === null) {
		delete store.trusted[projectPath];
	} else {
		store.trusted[projectPath] = currentHash;
	}

	delete store.declined[projectPath];

	writeStore(storePath, store);
}

export function forgetProjectTrust(projectPath: string, storePath: string): void {
	const store = readStore(storePath);

	delete store.trusted[projectPath];
	delete store.declined[projectPath];

	writeStore(storePath, store);
}

type JsonObject = Record<string, unknown>;

const isJsonObject = (value: unknown): value is JsonObject =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stringList = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const unionStrings = (firstList: unknown, secondList: unknown): string[] => [
	...new Set([...stringList(firstList), ...stringList(secondList)]),
];

const SUBAGENT_ORDER = [SubagentNetwork.Allow, SubagentNetwork.ResearchOnly, SubagentNetwork.Deny];
const OUTSIDE_PROJECT_ORDER = [ReadPosture.Allow, ReadPosture.Ask, ReadPosture.Deny];

type PolicyTier = string;

function selectStricterTier(
	tierOrder: readonly string[],
	currentTier: unknown,
	incomingTier: unknown,
): PolicyTier | undefined {
	const currentRank = tierOrder.indexOf(String(currentTier ?? tierOrder[0]));
	const incomingRank = tierOrder.indexOf(String(incomingTier));

	if (incomingRank > currentRank && typeof incomingTier === "string") {
		return incomingTier;
	}

	return typeof currentTier === "string" ? currentTier : undefined;
}

const ADDITIVE_DENY_KEYS = ["denyRead", "modelDenyRead", "denyWrite", "askRead"] as const;

export function applyUntrustedProject<T extends JsonObject>(
	basePolicy: T,
	untrustedProjectPolicy: JsonObject,
): { merged: T; ignored: string[] } {
	const ignoredKeys: string[] = [];
	const mergedPolicy = structuredClone(basePolicy) as JsonObject;

	for (const [key, value] of Object.entries(untrustedProjectPolicy)) {
		if (key.startsWith("_")) {
			continue;
		}

		if (key === "filesystem" && isJsonObject(value)) {
			const filesystem = {
				...(isJsonObject(mergedPolicy.filesystem) ? mergedPolicy.filesystem : {}),
			} as JsonObject;

			for (const [fieldKey, fieldValue] of Object.entries(value)) {
				if (fieldKey.startsWith("_")) {
					continue;
				}

				if ((ADDITIVE_DENY_KEYS as readonly string[]).includes(fieldKey)) {
					filesystem[fieldKey] = unionStrings(filesystem[fieldKey], fieldValue);
				} else if (fieldKey === "outsideProject" && isJsonObject(fieldValue)) {
					const outsideProject = {
						...(isJsonObject(filesystem.outsideProject) ? filesystem.outsideProject : {}),
					} as JsonObject;

					for (const [optionKey, optionValue] of Object.entries(fieldValue)) {
						if (optionKey === "read") {
							outsideProject.read = selectStricterTier(OUTSIDE_PROJECT_ORDER, outsideProject.read, optionValue);
						} else {
							ignoredKeys.push(`filesystem.outsideProject.${optionKey}`);
						}
					}

					filesystem.outsideProject = outsideProject;
				} else {
					ignoredKeys.push(`filesystem.${fieldKey}`);
				}
			}

			mergedPolicy.filesystem = filesystem;
		} else if (key === "network" && isJsonObject(value)) {
			const network = {
				...(isJsonObject(mergedPolicy.network) ? mergedPolicy.network : {}),
			} as JsonObject;

			for (const [networkKey, networkValue] of Object.entries(value)) {
				if (networkKey.startsWith("_")) {
					continue;
				}

				if (networkKey === "deniedDomains") {
					network.deniedDomains = unionStrings(network.deniedDomains, networkValue);
				} else {
					ignoredKeys.push(`network.${networkKey}`);
				}
			}

			mergedPolicy.network = network;
		} else if (key === "subagent" && isJsonObject(value)) {
			const subagent = {
				...(isJsonObject(mergedPolicy.subagent) ? mergedPolicy.subagent : {}),
			} as JsonObject;

			for (const [subagentKey, subagentValue] of Object.entries(value)) {
				if (subagentKey === "network") {
					subagent.network = selectStricterTier(SUBAGENT_ORDER, subagent.network, subagentValue);
				} else {
					ignoredKeys.push(`subagent.${subagentKey}`);
				}
			}

			mergedPolicy.subagent = subagent;
		} else if (key === "mcp" && isJsonObject(value)) {
			const mcpPolicy = {
				...(isJsonObject(mergedPolicy.mcp) ? mergedPolicy.mcp : {}),
			} as JsonObject;

			const currentThreshold = typeof mcpPolicy.askThreshold === "number" ? mcpPolicy.askThreshold : 30;

			for (const [mcpKey, mcpValue] of Object.entries(value)) {
				if (mcpKey.startsWith("_")) {
					continue;
				}

				if (mcpKey === "askTools") {
					mcpPolicy.askTools = unionStrings(mcpPolicy.askTools, mcpValue);
				} else if (mcpKey === "allowSimpleUpdates" && mcpValue === false) {
					mcpPolicy.allowSimpleUpdates = false;
				} else if (mcpKey === "trustAnnotations" && mcpValue === false) {
					mcpPolicy.trustAnnotations = false;
				} else if (mcpKey === "askThreshold" && typeof mcpValue === "number" && mcpValue <= currentThreshold) {
					mcpPolicy.askThreshold = mcpValue;
				} else {
					ignoredKeys.push(`mcp.${mcpKey}`);
				}
			}

			mergedPolicy.mcp = mcpPolicy;
		} else if (key === "mode") {
			const stricterMode = selectStricterTier(MODE_ORDER, mergedPolicy.mode, value);

			if (stricterMode !== undefined && value !== mergedPolicy.mode && stricterMode === mergedPolicy.mode) {
				ignoredKeys.push("mode");
			}

			if (stricterMode !== undefined) {
				mergedPolicy.mode = stricterMode;
			}
		} else {
			ignoredKeys.push(key);
		}
	}

	return { merged: mergedPolicy as T, ignored: ignoredKeys };
}

const formatStringList = (value: unknown): string => {
	const items = stringList(value);
	return items.length ? items.join(", ") : "(empty list)";
};

export function describeLoosening(projectPolicy: JsonObject): string[] {
	const changes: string[] = [];
	const filesystem = isJsonObject(projectPolicy.filesystem) ? projectPolicy.filesystem : {};
	const network = isJsonObject(projectPolicy.network) ? projectPolicy.network : {};
	const overrides = isJsonObject(projectPolicy.overrides) ? projectPolicy.overrides : {};
	const outsideProject = isJsonObject(filesystem.outsideProject) ? filesystem.outsideProject : {};
	const mcpPolicy = isJsonObject(projectPolicy.mcp) ? projectPolicy.mcp : {};

	const { ignored } = applyUntrustedProject({}, projectPolicy);

	if (typeof projectPolicy.mode === "string" && projectPolicy.mode !== PermissionMode.AdvancedSecure) {
		changes.push(
			projectPolicy.mode === PermissionMode.Yolo
				? "Turn off all security layers (YOLO)."
				: "Turn off Advanced Secure mode.",
		);
	}

	for (const key of ignored) {
		switch (key) {
			case "enabled":
				if (projectPolicy.enabled === false) {
					changes.push("Turn off auto-permission-system.");
				}
				break;
			case "enableWeakerNestedSandbox":
				if (projectPolicy.enableWeakerNestedSandbox) {
					changes.push("Make the bash sandbox weaker.");
				}
				break;
			case "ignoreViolations":
				changes.push("Hide some sandbox blocks.");
				break;
			case "overrides":
				if (stringList(overrides.allowWrite).length) {
					changes.push(`Let bash write to: ${formatStringList(overrides.allowWrite)}.`);
				}
				if (stringList(overrides.allowRead).length) {
					changes.push(`Let pi read: ${formatStringList(overrides.allowRead)}.`);
				}
				if (stringList(overrides.allowDomains).length) {
					changes.push(`Let pi connect to: ${formatStringList(overrides.allowDomains)}.`);
				}
				break;
			case "mode":
				break;
			case "filesystem.allowWrite":
				changes.push(`Let bash and pi write to: ${formatStringList(filesystem.allowWrite)}.`);
				break;
			case "filesystem.outsideProject.allowRead":
				changes.push(`Let pi read outside the project: ${formatStringList(outsideProject.allowRead)}.`);
				break;
			case "network.allowedDomains":
				changes.push(`Replace your list of allowed websites with: ${formatStringList(network.allowedDomains)}.`);
				break;
			case "mcp.allowTools":
			case "mcp.allowPrefixes":
				changes.push(
					`Let more MCP tools run without asking: ${formatStringList(mcpPolicy.allowTools ?? mcpPolicy.allowPrefixes)}.`,
				);
				break;
			case "mcp.trustAnnotations":
				changes.push("Trust MCP server annotations (read-only hints) to skip asks.");
				break;
			case "mcp.allowSimpleUpdates":
				changes.push("Let narrow MCP field updates run without asking.");
				break;
			case "mcp.askThreshold":
				changes.push("Raise the MCP risk score at which it asks.");
				break;
			default:
				changes.push(`Change the setting "${key}".`);
		}
	}

	return changes;
}
