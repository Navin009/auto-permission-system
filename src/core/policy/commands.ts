/** Commands/paths that can print secrets and must ask first (ADR-017). Pure. */

import { resolve } from "node:path";
import { shellSegments, shellTokens } from "./fence";
import { matchesPolicyPattern, normalizeAbs } from "./patterns";

/** Expand a leading `~`, then resolve relative to cwd. Returns null for non-paths. */
function asAbsolute(token: string, cwd: string, home: string): string | null {
	const t = token.trim();
	if (!t || t.startsWith("-")) return null;
	let p = t;
	if (p === "~") p = home;
	else if (p.startsWith("~/")) p = `${home}/${p.slice(2)}`;
	else if (!p.startsWith("/") && !p.startsWith("./") && !p.startsWith("../") && !p.includes("/")) return null;
	const abs = p.startsWith("/") ? p : resolve(cwd, p);
	return normalizeAbs(abs);
}

/**
 * Which `ask` entries a command hits. An entry without `/` or `~` is a command
 * name (matched on the segment head); one with a path is globbed against every
 * path token in the command, so a read of the per-process environ file is
 * caught whatever command performs it.
 */
export function matchedAskCommands(command: string, ask: readonly string[], cwd: string, home: string): string[] {
	const found = new Set<string>();
	if (!ask.length) return [];
	for (const segment of shellSegments(command)) {
		const tokens = shellTokens(segment);
		const head = (tokens[0] ?? "").split("/").pop() ?? "";
		for (const entry of ask) {
			if (!entry) continue;
			if (entry.includes("/") || entry.startsWith("~")) {
				for (const raw of tokens.slice(1)) {
					const abs = asAbsolute(raw, cwd, home);
					if (abs && matchesPolicyPattern(abs, entry, cwd, home)) found.add(`${head} ${raw}`.trim());
				}
			} else if (head === entry) {
				found.add(entry);
			}
		}
	}
	return [...found];
}
