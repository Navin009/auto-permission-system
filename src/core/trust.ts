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
import { MODE_ORDER } from "./policy/mode";

/** `trusted`: path → hash the user trusted. `declined`: path → hash the user said "no" to (no more warnings for it). */
type Store = { trusted: Record<string, string>; declined: Record<string, string> };

export function fileHash(path: string): string | null {
	if (!existsSync(path)) return null;
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readStore(storePath: string): Store {
	const empty = (): Store => ({ trusted: {}, declined: {} });
	if (!existsSync(storePath)) return empty();
	try {
		const o = JSON.parse(readFileSync(storePath, "utf-8")) as Partial<Store>;
		return { trusted: { ...(o?.trusted ?? {}) }, declined: { ...(o?.declined ?? {}) } };
	} catch {
		return empty();
	}
}

function writeStore(storePath: string, store: Store): void {
	mkdirSync(dirname(storePath), { recursive: true });
	writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`);
}

/** Trusted when the file's current hash is the one recorded for its path. An absent file is trivially trusted. */
export function isProjectFileTrusted(projectPath: string, storePath: string): boolean {
	const h = fileHash(projectPath);
	if (h === null) return true;
	return readStore(storePath).trusted[projectPath] === h;
}

/** The user said "no" to this exact content: do not warn again until the file changes. */
export function isProjectFileDeclined(projectPath: string, storePath: string): boolean {
	const h = fileHash(projectPath);
	return h !== null && readStore(storePath).declined[projectPath] === h;
}

export function recordProjectDeclined(projectPath: string, storePath: string): void {
	const store = readStore(storePath);
	const h = fileHash(projectPath);
	if (h === null) return;
	store.declined[projectPath] = h;
	delete store.trusted[projectPath];
	writeStore(storePath, store);
}

/** Record the file's current content as trusted (or forget it when the file is gone). */
export function recordProjectTrust(projectPath: string, storePath: string): void {
	const store = readStore(storePath);
	const h = fileHash(projectPath);
	if (h === null) delete store.trusted[projectPath];
	else store.trusted[projectPath] = h;
	delete store.declined[projectPath];
	writeStore(storePath, store);
}

export function forgetProjectTrust(projectPath: string, storePath: string): void {
	const store = readStore(storePath);
	delete store.trusted[projectPath];
	delete store.declined[projectPath];
	writeStore(storePath, store);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const union = (a: unknown, b: unknown): string[] => [...new Set([...strings(a), ...strings(b)])];

const SUBAGENT_ORDER = ["allow", "research-only", "deny"];
const OUTSIDE_ORDER = ["allow", "ask", "deny"];
/** One tier of an ordered policy ladder (`allow` < `ask` < `deny`, etc.). */
type Tier = string;

/**
 * Pick whichever of `base`/`project` ranks strictly later in `order`; an input
 * that is not a string is ignored (never returned as `unknown`).
 */
function stricter(order: readonly string[], base: unknown, project: unknown): Tier | undefined {
	const b = order.indexOf(String(base ?? order[0]));
	const p = order.indexOf(String(project));
	if (p > b && typeof project === "string") return project;
	return typeof base === "string" ? base : undefined;
}

/** Lists an untrusted file may add to (additive: deny lists and the ask list). */
const DENY_KEYS = ["denyRead", "modelDenyRead", "denyWrite", "askRead"] as const;

/**
 * Merge an untrusted project policy into `base` so it can only tighten.
 * Returns the merged policy and the keys that were ignored (for the warning).
 */
export function applyUntrustedProject<T extends Obj>(base: T, project: Obj): { merged: T; ignored: string[] } {
	const ignored: string[] = [];
	const merged = structuredClone(base) as Obj;

	for (const [key, value] of Object.entries(project)) {
		if (key.startsWith("_")) continue; // comments
		if (key === "filesystem" && isObj(value)) {
			const fs = { ...(isObj(merged.filesystem) ? merged.filesystem : {}) } as Obj;
			for (const [fk, fv] of Object.entries(value)) {
				if (fk.startsWith("_")) continue;
				if ((DENY_KEYS as readonly string[]).includes(fk)) fs[fk] = union(fs[fk], fv);
				else if (fk === "outsideProject" && isObj(fv)) {
					const op = { ...(isObj(fs.outsideProject) ? fs.outsideProject : {}) } as Obj;
					for (const [ok, ov] of Object.entries(fv)) {
						if (ok === "read") op.read = stricter(OUTSIDE_ORDER, op.read, ov);
						else ignored.push(`filesystem.outsideProject.${ok}`);
					}
					fs.outsideProject = op;
				} else ignored.push(`filesystem.${fk}`);
			}
			merged.filesystem = fs;
		} else if (key === "network" && isObj(value)) {
			const net = { ...(isObj(merged.network) ? merged.network : {}) } as Obj;
			for (const [nk, nv] of Object.entries(value)) {
				if (nk.startsWith("_")) continue;
				if (nk === "deniedDomains") net.deniedDomains = union(net.deniedDomains, nv);
				else ignored.push(`network.${nk}`);
			}
			merged.network = net;
		} else if (key === "subagent" && isObj(value)) {
			const sa = { ...(isObj(merged.subagent) ? merged.subagent : {}) } as Obj;
			for (const [sk, sv] of Object.entries(value)) {
				if (sk === "network") sa.network = stricter(SUBAGENT_ORDER, sa.network, sv);
				else ignored.push(`subagent.${sk}`);
			}
			merged.subagent = sa;
		} else if (key === "mode") {
			// An untrusted project may move UP the ladder (toward strict), never down:
			// a project cannot turn on YOLO, and cannot drop Advanced Secure.
			const next = stricter(MODE_ORDER, merged.mode, value);
			if (next !== undefined && value !== merged.mode && next === merged.mode) ignored.push("mode");
			if (next !== undefined) merged.mode = next;
		} else {
			ignored.push(key);
		}
	}
	return { merged: merged as T, ignored };
}

const listOf = (v: unknown): string => {
	const xs = strings(v);
	return xs.length ? xs.join(", ") : "(empty list)";
};

/**
 * What an untrusted project file tries to change, in short plain sentences
 * (ASD-STE100 style), for the warning and the trust question. Only changes
 * that make the policy weaker are listed.
 */
export function describeLoosening(project: Obj): string[] {
	const out: string[] = [];
	const fs = isObj(project.filesystem) ? project.filesystem : {};
	const net = isObj(project.network) ? project.network : {};
	const ov = isObj(project.overrides) ? project.overrides : {};
	const op = isObj(fs.outsideProject) ? fs.outsideProject : {};
	const { ignored } = applyUntrustedProject({}, project);
	// `mode` may not land in `ignored` when the base has no mode, so describe it
	// directly: any value below `advanced-secure` is a loosening.
	if (typeof project.mode === "string" && project.mode !== "advanced-secure") {
		out.push(project.mode === "yolo" ? "Turn off all security layers (YOLO)." : "Turn off Advanced Secure mode.");
	}
	for (const key of ignored) {
		switch (key) {
			case "enabled":
				if (project.enabled === false) out.push("Turn off auto-permission-system.");
				break;
			case "enableWeakerNestedSandbox":
				if (project.enableWeakerNestedSandbox) out.push("Make the bash sandbox weaker.");
				break;
			case "ignoreViolations":
				out.push("Hide some sandbox blocks.");
				break;
			case "overrides":
				if (strings(ov.allowWrite).length) out.push(`Let bash write to: ${listOf(ov.allowWrite)}.`);
				if (strings(ov.allowRead).length) out.push(`Let pi read: ${listOf(ov.allowRead)}.`);
				if (strings(ov.allowDomains).length) out.push(`Let pi connect to: ${listOf(ov.allowDomains)}.`);
				break;
			case "mode":
				break; // handled above
			case "filesystem.allowWrite":
				out.push(`Let bash and pi write to: ${listOf(fs.allowWrite)}.`);
				break;
			case "filesystem.outsideProject.allowRead":
				out.push(`Let pi read outside the project: ${listOf(op.allowRead)}.`);
				break;
			case "network.allowedDomains":
				out.push(`Replace your list of allowed websites with: ${listOf(net.allowedDomains)}.`);
				break;
			default:
				out.push(`Change the setting "${key}".`);
		}
	}
	return out;
}
