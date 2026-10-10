/**
 * Commands/paths that can print secrets and must ask first (ADR-017). Pure.
 */

import { resolve } from "node:path";
import { shellSegments, shellTokens } from "./fence";
import { matchesPolicyPattern, normalizeAbs } from "./patterns";

/** Expand a leading `~`, then resolve relative to cwd. Returns null for non-paths. */
function asAbsolutePath(rawToken: string, cwd: string, home: string): string | null {
	const token = rawToken.trim();
	if (!token || token.startsWith("-")) return null;
	let path = token;
	if (path === "~") path = home;
	else if (path.startsWith("~/")) path = `${home}/${path.slice(2)}`;
	else if (!path.startsWith("/") && !path.startsWith("./") && !path.startsWith("../") && !path.includes("/")) return null;
	const absolute = path.startsWith("/") ? path : resolve(cwd, path);
	return normalizeAbs(absolute);
}

/**
 * Which `ask` entries a command hits. An entry without `/` or `~` is a command
 * name (matched on the segment head); one with a path is globbed against every
 * path token in the command, so a read of the per-process environ file is
 * caught whatever command performs it.
 */
export function matchedAskCommands(command: string, askEntries: readonly string[], cwd: string, home: string): string[] {
	const found = new Set<string>();
	if (!askEntries.length) return [];
	for (const segment of shellSegments(command)) {
		const tokens = shellTokens(segment);
		const head = (tokens[0] ?? "").split("/").pop() ?? "";
		for (const entry of askEntries) {
			if (!entry) continue;
			if (entry.includes("/") || entry.startsWith("~")) {
				for (const raw of tokens.slice(1)) {
					const absolute = asAbsolutePath(raw, cwd, home);
					if (absolute && matchesPolicyPattern(absolute, entry, cwd, home)) found.add(`${head} ${raw}`.trim());
				}
			} else if (head === entry) {
				found.add(entry);
			}
		}
	}
	return [...found];
}
