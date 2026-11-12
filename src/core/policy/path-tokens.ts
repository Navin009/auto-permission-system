import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { matchesPolicyPattern, normalizeAbs } from "./patterns.ts";
import { normalizeUserPath } from "./user-path.ts";

const FLAG_PATTERN = /^-/;
const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const GLOB_PATTERN = /[*?]/;
const EMBEDDED_SEPARATOR_PATTERN = /[^A-Za-z0-9_.~/@%+-]+/;

/**
 * Regex and shell-expression markers. A token that carries one is data (a
 * grep pattern, a code string), so only its quoted parts and its whole
 * spelling can name a file: splitting `'\.env'` on the backslash fabricated
 * the path `.env` and asked for a read of a file the command never opened
 * (ADR-050). A code string keeps working because its paths are quoted:
 * `readFileSync('.env')` still yields `.env`.
 */
const REGEX_METACHARACTER_PATTERN = /[\\^$[\]()|+]/;
const QUOTED_SPAN_PATTERN = /['"]([^'"]+)['"]/g;
const TRAILING_SLASHES = /\/+$/;

const SKIPPED_DIRECTORY_NAMES = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"target",
	".venv",
	"venv",
	"__pycache__",
]);

const MAXIMUM_DIRECTORY_FILES = 1000;
const UNLIMITED_DEPTH = Number.MAX_SAFE_INTEGER;

export interface PathCandidateOptions {
	expandGlob?: (absolutePattern: string) => string[];
	listDirectory?: (absoluteDirectory: string, maximumDepth?: number) => string[];
}

export function looksLikePath(token: string): boolean {
	if (!token || FLAG_PATTERN.test(token) || URL_PATTERN.test(token)) return false;
	if (token === "." || token === "..") return true;
	if (token.startsWith("~") || token.startsWith("/")) return true;
	if (token.startsWith("./") || token.startsWith("../")) return true;
	if (token.startsWith(".") && token.length > 1) return true;

	return token.includes("/");
}

export function embeddedPathTokens(token: string): string[] {
	const quotedFragments = [...token.matchAll(QUOTED_SPAN_PATTERN)].map((match) => match[1] as string);

	if (REGEX_METACHARACTER_PATTERN.test(token)) {
		return [token, ...quotedFragments].filter(looksLikePath);
	}

	if (!looksLikePath(token) && !token.includes(".")) return [];

	const candidates = new Set<string>([token]);

	for (const fragment of quotedFragments) candidates.add(fragment);

	for (const piece of token.split(EMBEDDED_SEPARATOR_PATTERN)) candidates.add(piece);

	return [...candidates].filter(looksLikePath);
}

function toAbsolutePath(token: string, workingDirectory: string, homeDirectory: string): string {
	const normalizedToken = normalizeUserPath(token, homeDirectory);

	if (normalizedToken.startsWith("/")) return normalizeAbs(normalizedToken);

	return normalizeAbs(`${workingDirectory.replace(TRAILING_SLASHES, "")}/${normalizedToken}`);
}

function expandGlobPattern(absolutePattern: string): string[] {
	const directory = dirname(absolutePattern);
	const basenamePattern = absolutePattern.slice(directory.length + 1);

	if (!GLOB_PATTERN.test(basenamePattern)) return [absolutePattern];

	try {
		const entries = readdirSync(directory);
		const matches = entries
			.filter((entry) => matchesPolicyPattern(`${directory}/${entry}`, basenamePattern, directory, directory))
			.map((entry) => `${directory}/${entry}`);

		return matches.length ? matches : [absolutePattern];
	} catch {
		return [absolutePattern];
	}
}

function entryDepth(entry: string): number {
	return entry.split("/").length;
}

function isSkippedEntry(entry: string): boolean {
	return entry.split("/").some((part) => SKIPPED_DIRECTORY_NAMES.has(part));
}

export function listDirectoryFiles(absoluteDirectory: string, maximumDepth: number = UNLIMITED_DEPTH): string[] {
	try {
		const entries = readdirSync(absoluteDirectory, { recursive: true, encoding: "utf8" });

		return entries
			.filter((entry) => entryDepth(entry) <= maximumDepth && !isSkippedEntry(entry))
			.map((entry) => `${absoluteDirectory.replace(TRAILING_SLASHES, "")}/${entry}`)
			.slice(0, MAXIMUM_DIRECTORY_FILES);
	} catch {
		return [];
	}
}

export function resolveTokenPaths(
	token: string,
	workingDirectory: string,
	homeDirectory: string,
	options: PathCandidateOptions,
): string[] {
	const absolutePattern = toAbsolutePath(token, workingDirectory, homeDirectory);
	const expandGlob = options.expandGlob ?? expandGlobPattern;
	const matches = GLOB_PATTERN.test(absolutePattern) ? expandGlob(absolutePattern) : [absolutePattern];

	return matches.map((match) => normalizeAbs(match));
}
