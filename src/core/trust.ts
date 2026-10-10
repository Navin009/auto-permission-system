/**
 * Project trust for `<cwd>/.pi/sandbox.json` (ADR-013).
 *
 * A project policy file arrives with whatever repository you clone. Without
 * trust it may only tighten the policy: its deny lists are added to yours,
 * stricter postures win, and everything that could loosen (enabled, allow
 * lists, overrides, sandbox weakening flags) is ignored. A file is trusted
 * when its SHA-256 is recorded in the trust store, which only `/security
 * trust` and auto-permission-system's own "Allow and remember…" writes (of an
 * already trusted file) update.
 *
 * No pi imports: security/tests/unit/project-trust.mjs imports this file directly.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { MODE_ORDER, PermissionMode } from "./policy/mode";
import { projectPolicyPath } from "./policy/paths";
import { ReadPosture } from "./policy/classify";
import { SubagentNetwork } from "./policy/subagent";

/** `trusted`: path → hash the user trusted. `declined`: path → hash the user said "no" to (no more warnings for it). */
interface TrustStore {
	trusted: Record<string, string>;
	declined: Record<string, string>;
}

/** SHA-256 of a file's bytes, or null when the file does not exist. */
export function fileHash(path: string): string | null {
	if (!existsSync(path)) return null;
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readStore(storePath: string): TrustStore {
	const empty = (): TrustStore => ({ trusted: {}, declined: {} });
	if (!existsSync(storePath)) return empty();
	try {
		const parsed = JSON.parse(readFileSync(storePath, "utf-8")) as Partial<TrustStore>;
		return { trusted: { ...(parsed?.trusted ?? {}) }, declined: { ...(parsed?.declined ?? {}) } };
	} catch {
		return empty();
	}
}

function writeStore(storePath: string, store: TrustStore): void {
	mkdirSync(dirname(storePath), { recursive: true });
	writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`);
}

/** Trusted when the file's current hash is the one recorded for its path. An absent file is trivially trusted. */
export function isProjectFileTrusted(projectPath: string, storePath: string): boolean {
	const hash = fileHash(projectPath);
	if (hash === null) return true;
	return readStore(storePath).trusted[projectPath] === hash;
}

/** The user said "no" to this exact content: do not warn again until the file changes. */
export function isProjectFileDeclined(projectPath: string, storePath: string): boolean {
	const hash = fileHash(projectPath);
	return hash !== null && readStore(storePath).declined[projectPath] === hash;
}

/**
 * One layer's project-policy trust decision, bound to a trust store. Each
 * extension creates its own instance: the entrypoints load as separate modules
 * and share only the store file (ADR-018/ADR-020).
 */
export interface ProjectTrust {
	/** Record pi's own project-trust answer for this session. Declined is never trusted. */
	setDeclined(value: boolean): void;
	/** The project file applies in full only when its current hash is recorded and pi did not decline. */
	isTrusted(cwd: string): boolean;
}

export function createProjectTrust(storePath: string): ProjectTrust {
	let declined = false;
	return {
		setDeclined(value: boolean): void {
			declined = value;
		},
		isTrusted(cwd: string): boolean {
			return !declined && isProjectFileTrusted(projectPolicyPath(cwd), storePath);
		},
	};
}

export function recordProjectDeclined(projectPath: string, storePath: string): void {
	const store = readStore(storePath);
	const hash = fileHash(projectPath);
	if (hash === null) return;
	store.declined[projectPath] = hash;
	delete store.trusted[projectPath];
	writeStore(storePath, store);
}

/** Record the file's current content as trusted (or forget it when the file is gone). */
export function recordProjectTrust(projectPath: string, storePath: string): void {
	const store = readStore(storePath);
	const hash = fileHash(projectPath);
	if (hash === null) delete store.trusted[projectPath];
	else store.trusted[projectPath] = hash;
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

const isJsonObject = (value: unknown): value is JsonObject => !!value && typeof value === "object" && !Array.isArray(value);
const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const unionStrings = (first: unknown, second: unknown): string[] => [...new Set([...stringList(first), ...stringList(second)])];

const SUBAGENT_ORDER = [SubagentNetwork.Allow, SubagentNetwork.ResearchOnly, SubagentNetwork.Deny];
const OUTSIDE_PROJECT_ORDER = [ReadPosture.Allow, ReadPosture.Ask, ReadPosture.Deny];

/** One tier of an ordered policy ladder (`allow` < `ask` < `deny`, etc.). */
type PolicyTier = string;

/**
 * Pick whichever of `current`/`incoming` ranks strictly later in `order`; an
 * input that is not a string is ignored (never returned as `unknown`).
 */
function stricter(order: readonly string[], current: unknown, incoming: unknown): PolicyTier | undefined {
	const currentRank = order.indexOf(String(current ?? order[0]));
	const incomingRank = order.indexOf(String(incoming));
	if (incomingRank > currentRank && typeof incoming === "string") return incoming;
	return typeof current === "string" ? current : undefined;
}

/** Lists an untrusted file may add to (additive: deny lists and the ask list). */
const ADDITIVE_DENY_KEYS = ["denyRead", "modelDenyRead", "denyWrite", "askRead"] as const;

/**
 * Merge an untrusted project policy into `base` so it can only tighten.
 * Returns the merged policy and the keys that were ignored (for the warning).
 *
 * `_`-prefixed keys are comments and skipped everywhere. `mode` may only move
 * UP the ladder (toward strict), never down: a project cannot turn on YOLO,
 * and cannot drop Advanced Secure.
 */
export function applyUntrustedProject<T extends JsonObject>(base: T, project: JsonObject): { merged: T; ignored: string[] } {
	const ignored: string[] = [];
	const merged = structuredClone(base) as JsonObject;

	for (const [key, value] of Object.entries(project)) {
		if (key.startsWith("_")) continue;
		if (key === "filesystem" && isJsonObject(value)) {
			const filesystem = { ...(isJsonObject(merged.filesystem) ? merged.filesystem : {}) } as JsonObject;
			for (const [fieldKey, fieldValue] of Object.entries(value)) {
				if (fieldKey.startsWith("_")) continue;
				if ((ADDITIVE_DENY_KEYS as readonly string[]).includes(fieldKey)) filesystem[fieldKey] = unionStrings(filesystem[fieldKey], fieldValue);
				else if (fieldKey === "outsideProject" && isJsonObject(fieldValue)) {
					const outsideProject = { ...(isJsonObject(filesystem.outsideProject) ? filesystem.outsideProject : {}) } as JsonObject;
					for (const [optionKey, optionValue] of Object.entries(fieldValue)) {
						if (optionKey === "read") outsideProject.read = stricter(OUTSIDE_PROJECT_ORDER, outsideProject.read, optionValue);
						else ignored.push(`filesystem.outsideProject.${optionKey}`);
					}
					filesystem.outsideProject = outsideProject;
				} else ignored.push(`filesystem.${fieldKey}`);
			}
			merged.filesystem = filesystem;
		} else if (key === "network" && isJsonObject(value)) {
			const network = { ...(isJsonObject(merged.network) ? merged.network : {}) } as JsonObject;
			for (const [networkKey, networkValue] of Object.entries(value)) {
				if (networkKey.startsWith("_")) continue;
				if (networkKey === "deniedDomains") network.deniedDomains = unionStrings(network.deniedDomains, networkValue);
				else ignored.push(`network.${networkKey}`);
			}
			merged.network = network;
		} else if (key === "subagent" && isJsonObject(value)) {
			const subagent = { ...(isJsonObject(merged.subagent) ? merged.subagent : {}) } as JsonObject;
			for (const [subagentKey, subagentValue] of Object.entries(value)) {
				if (subagentKey === "network") subagent.network = stricter(SUBAGENT_ORDER, subagent.network, subagentValue);
				else ignored.push(`subagent.${subagentKey}`);
			}
			merged.subagent = subagent;
		} else if (key === "mcp" && isJsonObject(value)) {
			const mcp = { ...(isJsonObject(merged.mcp) ? merged.mcp : {}) } as JsonObject;
			const currentThreshold = typeof mcp.askThreshold === "number" ? mcp.askThreshold : 30;
			for (const [mcpKey, mcpValue] of Object.entries(value)) {
				if (mcpKey.startsWith("_")) continue;
				if (mcpKey === "askTools") mcp.askTools = unionStrings(mcp.askTools, mcpValue);
				else if (mcpKey === "allowSimpleUpdates" && mcpValue === false) mcp.allowSimpleUpdates = false;
				else if (mcpKey === "trustAnnotations" && mcpValue === false) mcp.trustAnnotations = false;
				else if (mcpKey === "askThreshold" && typeof mcpValue === "number" && mcpValue <= currentThreshold) mcp.askThreshold = mcpValue;
				else ignored.push(`mcp.${mcpKey}`);
			}
			merged.mcp = mcp;
		} else if (key === "mode") {
			const stricterMode = stricter(MODE_ORDER, merged.mode, value);
			if (stricterMode !== undefined && value !== merged.mode && stricterMode === merged.mode) ignored.push("mode");
			if (stricterMode !== undefined) merged.mode = stricterMode;
		} else {
			ignored.push(key);
		}
	}
	return { merged: merged as T, ignored };
}

/** Render a string list for the warning text, or `(empty list)` when it has no entries. */
const describeList = (value: unknown): string => {
	const items = stringList(value);
	return items.length ? items.join(", ") : "(empty list)";
};

/**
 * What an untrusted project file tries to change, in short plain sentences
 * (ASD-STE100 style), for the warning and the trust question. Only changes
 * that make the policy weaker are listed.
 *
 * `mode` may not land in `ignored` when the base has no mode, so it is
 * described directly: any value below `advanced-secure` is a loosening.
 */
export function describeLoosening(project: JsonObject): string[] {
	const changes: string[] = [];
	const filesystem = isJsonObject(project.filesystem) ? project.filesystem : {};
	const network = isJsonObject(project.network) ? project.network : {};
	const overrides = isJsonObject(project.overrides) ? project.overrides : {};
	const outsideProject = isJsonObject(filesystem.outsideProject) ? filesystem.outsideProject : {};
	const mcp = isJsonObject(project.mcp) ? project.mcp : {};
	const { ignored } = applyUntrustedProject({}, project);
	if (typeof project.mode === "string" && project.mode !== PermissionMode.AdvancedSecure) {
		changes.push(project.mode === PermissionMode.Yolo ? "Turn off all security layers (YOLO)." : "Turn off Advanced Secure mode.");
	}
	for (const key of ignored) {
		switch (key) {
			case "enabled":
				if (project.enabled === false) changes.push("Turn off auto-permission-system.");
				break;
			case "enableWeakerNestedSandbox":
				if (project.enableWeakerNestedSandbox) changes.push("Make the bash sandbox weaker.");
				break;
			case "ignoreViolations":
				changes.push("Hide some sandbox blocks.");
				break;
			case "overrides":
				if (stringList(overrides.allowWrite).length) changes.push(`Let bash write to: ${describeList(overrides.allowWrite)}.`);
				if (stringList(overrides.allowRead).length) changes.push(`Let pi read: ${describeList(overrides.allowRead)}.`);
				if (stringList(overrides.allowDomains).length) changes.push(`Let pi connect to: ${describeList(overrides.allowDomains)}.`);
				break;
			case "mode":
				break;
			case "filesystem.allowWrite":
				changes.push(`Let bash and pi write to: ${describeList(filesystem.allowWrite)}.`);
				break;
			case "filesystem.outsideProject.allowRead":
				changes.push(`Let pi read outside the project: ${describeList(outsideProject.allowRead)}.`);
				break;
			case "network.allowedDomains":
				changes.push(`Replace your list of allowed websites with: ${describeList(network.allowedDomains)}.`);
				break;
			case "mcp.allowTools":
			case "mcp.allowPrefixes":
				changes.push(`Let more MCP tools run without asking: ${describeList(mcp.allowTools ?? mcp.allowPrefixes)}.`);
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
