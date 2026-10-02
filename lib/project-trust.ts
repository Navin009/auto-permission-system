/**
 * Project trust for `<cwd>/.pi/sandbox.json` (ADR-013).
 *
 * A project policy file arrives with whatever repository you clone. Without
 * trust it may only tighten the policy: its deny lists are added to yours,
 * stricter postures win, and everything that could loosen (enabled, allow
 * lists, overrides, sandbox weakening flags) is ignored. A file is trusted
 * when its SHA-256 is recorded in the trust store, which only `/security
 * trust` and pi-secure-it's own "always for CURRENT project" writes (of an
 * already trusted file) update.
 *
 * No pi imports: security/tests/project-trust.mjs imports this file directly.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type Store = Record<string, string>;

export function fileHash(path: string): string | null {
	if (!existsSync(path)) return null;
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readStore(storePath: string): Store {
	if (!existsSync(storePath)) return {};
	try {
		const o = JSON.parse(readFileSync(storePath, "utf-8"));
		return o && typeof o === "object" ? (o as Store) : {};
	} catch {
		return {};
	}
}

/** Trusted when the file's current hash is the one recorded for its path. An absent file is trivially trusted. */
export function isProjectFileTrusted(projectPath: string, storePath: string): boolean {
	const h = fileHash(projectPath);
	if (h === null) return true;
	return readStore(storePath)[projectPath] === h;
}

/** Record the file's current content as trusted (or forget it when the file is gone). */
export function recordProjectTrust(projectPath: string, storePath: string): void {
	const store = readStore(storePath);
	const h = fileHash(projectPath);
	if (h === null) delete store[projectPath];
	else store[projectPath] = h;
	mkdirSync(dirname(storePath), { recursive: true });
	writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`);
}

export function forgetProjectTrust(projectPath: string, storePath: string): void {
	const store = readStore(storePath);
	delete store[projectPath];
	mkdirSync(dirname(storePath), { recursive: true });
	writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const union = (a: unknown, b: unknown): string[] => [...new Set([...strings(a), ...strings(b)])];

const SUBAGENT_ORDER = ["allow", "research-only", "deny"];
const OUTSIDE_ORDER = ["allow", "ask", "deny"];
function stricter(order: string[], base: unknown, project: unknown): unknown {
	const b = order.indexOf(String(base ?? order[0]));
	const p = order.indexOf(String(project));
	return p > b ? project : base;
}

/** Deny lists an untrusted file may add to. */
const DENY_KEYS = ["denyRead", "modelDenyRead", "denyWrite"] as const;

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
		} else {
			ignored.push(key);
		}
	}
	return { merged: merged as T, ignored };
}
