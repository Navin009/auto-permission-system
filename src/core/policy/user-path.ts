import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const AT_PREFIX = "@";
const FILE_URL_PREFIX = "file://";
const HOME = "~";
const HOME_PREFIX = "~/";

export function normalizeUserPath(rawPath: string, homeDirectory = homedir()): string {
	const foldedPath = rawPath.replace(UNICODE_SPACES, " ");
	const unanchoredPath = foldedPath.startsWith(AT_PREFIX) ? foldedPath.slice(AT_PREFIX.length) : foldedPath;

	if (unanchoredPath.startsWith(FILE_URL_PREFIX)) {
		try {
			return fileURLToPath(unanchoredPath);
		} catch {
			return unanchoredPath;
		}
	}

	if (unanchoredPath === HOME) return homeDirectory;

	if (unanchoredPath.startsWith(HOME_PREFIX)) return join(homeDirectory, unanchoredPath.slice(HOME_PREFIX.length));

	return unanchoredPath;
}
