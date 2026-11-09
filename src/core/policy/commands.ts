import { resolve } from "node:path";
import { commandHead, commandSegments, shellTokens } from "./shell-command.ts";
import { matchesPolicyPattern, normalizeAbs } from "./patterns.ts";

function asAbsolutePath(rawToken: string, workingDirectory: string, homeDirectory: string): string | null {
	const token = rawToken.trim();

	if (!token || token.startsWith("-")) {
		return null;
	}

	let path = token;

	if (path === "~") {
		path = homeDirectory;
	} else if (path.startsWith("~/")) {
		path = `${homeDirectory}/${path.slice(2)}`;
	} else if (!path.startsWith("/") && !path.startsWith("./") && !path.startsWith("../") && !path.includes("/")) {
		return null;
	}

	const absolute = path.startsWith("/") ? path : resolve(workingDirectory, path);

	return normalizeAbs(absolute);
}

export function matchedAskCommands(
	command: string,
	askEntries: readonly string[],
	workingDirectory: string,
	homeDirectory: string,
): string[] {
	if (!askEntries.length) {
		return [];
	}

	const matchedEntries = new Set<string>();

	for (const segment of commandSegments(command)) {
		const tokens = shellTokens(segment);
		const { head, headIndex } = commandHead(tokens);

		for (const entry of askEntries) {
			if (!entry) {
				continue;
			}

			if (entry.includes("/") || entry.startsWith("~")) {
				for (const rawToken of tokens.slice(headIndex + 1)) {
					const absolutePath = asAbsolutePath(rawToken, workingDirectory, homeDirectory);

					if (absolutePath && matchesPolicyPattern(absolutePath, entry, workingDirectory, homeDirectory)) {
						matchedEntries.add(`${head} ${rawToken}`.trim());
					}
				}
			} else if (head === entry) {
				matchedEntries.add(entry);
			}
		}
	}

	return [...matchedEntries];
}
