import { matchesGlob, matchesPolicyPattern, normalizeAbs } from "./patterns.ts";
import { listDirectoryFiles, resolveTokenPaths, type PathCandidateOptions } from "./path-tokens.ts";

const NAME_PREDICATE = "-name";
const MAXIMUM_DEPTH_PREDICATE = "-maxdepth";
const MINIMUM_DEPTH_PREDICATE = "-mindepth";

const NEGATION_PREDICATES = new Set(["-not", "!"]);
const AND_PREDICATES = new Set(["-a", "-and"]);
const OR_PREDICATES = new Set(["-o", "-or"]);
const PATH_PREDICATES = new Set(["-path", "-wholename"]);

const FLAG_ONLY_PREDICATES = new Set([
	"-print", "-print0", "-ls", "-prune", "-depth", "-d", "-empty", "-readable",
	"-writable", "-executable", "-mount", "-xdev", "-noleaf", "-quit", "-true", "-false",
]);

const VALUE_PREDICATES = new Set([
	NAME_PREDICATE, MAXIMUM_DEPTH_PREDICATE, MINIMUM_DEPTH_PREDICATE,
	"-iname", "-path", "-ipath", "-wholename", "-iwholename", "-regex", "-iregex",
	"-lname", "-ilname", "-type", "-xtype", "-size", "-perm", "-user", "-group",
	"-uid", "-gid", "-newer", "-anewer", "-cnewer", "-mtime", "-atime", "-ctime",
	"-mmin", "-amin", "-cmin", "-links", "-inum", "-samefile", "-fstype",
]);

const UNSUPPORTED_PREDICATES = new Set([
	"-exec", "-execdir", "-ok", "-okdir", "-delete",
	"-printf", "-fprint", "-fprint0", "-fprintf", "-fls",
]);

const DEPTH_VALUE_PATTERN = /^\d+$/;
const RELATIVE_TARGET_PREFIX = "./";
const DEFAULT_FIND_TARGET = ".";
const ABSENT_DEPTH = Number.MAX_SAFE_INTEGER;

export interface FindQuery {
	targets: string[];
	namePatterns: string[];
	excludedNames: string[];
	excludedPaths: string[];
	maximumDepth?: number;
	minimumDepth?: number;
}

function parseDepth(value: string | undefined): number | undefined {
	if (value === undefined || !DEPTH_VALUE_PATTERN.test(value)) return undefined;

	return Number(value);
}

function isTargetToken(token: string): boolean {
	return !token.startsWith("-") && !NEGATION_PREDICATES.has(token);
}

export function parseFindQuery(tokens: readonly string[]): FindQuery | undefined {
	const targets: string[] = [];
	const namePatterns: string[] = [];
	const excludedNames: string[] = [];
	const excludedPaths: string[] = [];
	let maximumDepth: number | undefined;
	let minimumDepth: number | undefined;
	let isNegated = false;
	let position = 0;

	while (position < tokens.length && isTargetToken(tokens[position])) {
		targets.push(tokens[position]);
		position++;
	}

	while (position < tokens.length) {
		const predicate = tokens[position];

		if (UNSUPPORTED_PREDICATES.has(predicate) || OR_PREDICATES.has(predicate)) return undefined;

		if (AND_PREDICATES.has(predicate)) {
			isNegated = false;
			position++;
			continue;
		}

		if (NEGATION_PREDICATES.has(predicate)) {
			isNegated = true;
			position++;
			continue;
		}

		if (FLAG_ONLY_PREDICATES.has(predicate) || !VALUE_PREDICATES.has(predicate)) {
			position++;
			continue;
		}

		const value = tokens[position + 1];

		if (value === undefined) return undefined;

		if (isNegated) {
			if (!PATH_PREDICATES.has(predicate) && predicate !== NAME_PREDICATE) return undefined;

			if (PATH_PREDICATES.has(predicate)) excludedPaths.push(value);
			if (predicate === NAME_PREDICATE) excludedNames.push(value);
		} else {
			if (predicate === NAME_PREDICATE) namePatterns.push(value);
			if (predicate === MAXIMUM_DEPTH_PREDICATE) maximumDepth = parseDepth(value);
			if (predicate === MINIMUM_DEPTH_PREDICATE) minimumDepth = parseDepth(value);
		}

		isNegated = false;
		position += 2;
	}

	return { targets, namePatterns, excludedNames, excludedPaths, maximumDepth, minimumDepth };
}

function candidateDepth(candidatePath: string, targetPath: string): number {
	if (candidatePath === targetPath) return 0;
	if (!candidatePath.startsWith(`${targetPath}/`)) return ABSENT_DEPTH;

	return candidatePath.slice(targetPath.length + 1).split("/").length;
}

function matchesFindGlob(text: string, findPattern: string): boolean {
	return matchesGlob(text, findPattern.replace(/\*/g, "**"));
}

function absoluteExclusionPattern(pattern: string, workingDirectory: string): string {
	if (pattern.startsWith("/")) return pattern;

	const relativePattern = pattern.startsWith(RELATIVE_TARGET_PREFIX)
		? pattern.slice(RELATIVE_TARGET_PREFIX.length)
		: pattern;

	return `${workingDirectory}/${relativePattern}`;
}

function isExcludedByQuery(
	candidatePath: string,
	query: FindQuery,
	workingDirectory: string,
): boolean {
	const basename = candidatePath.slice(candidatePath.lastIndexOf("/") + 1);

	const isExcludedPath = query.excludedPaths.some((pattern) =>
		matchesFindGlob(candidatePath, absoluteExclusionPattern(pattern, workingDirectory)),
	);
	const isExcludedName = query.excludedNames.some((pattern) => matchesFindGlob(basename, pattern));

	return isExcludedPath || isExcludedName;
}

function matchesNameFilter(
	candidatePath: string,
	query: FindQuery,
	workingDirectory: string,
	homeDirectory: string,
): boolean {
	if (!query.namePatterns.length) return true;

	return query.namePatterns.some((pattern) =>
		matchesPolicyPattern(candidatePath, pattern, workingDirectory, homeDirectory),
	);
}

export function findReadCandidates(
	tokens: readonly string[],
	workingDirectory: string,
	homeDirectory: string,
	checkFileExists: (path: string) => boolean,
	options: PathCandidateOptions,
): string[] | undefined {
	const query = parseFindQuery(tokens);

	if (!query) return undefined;

	const listDirectory = options.listDirectory ?? listDirectoryFiles;
	const targets = query.targets.length ? query.targets : [DEFAULT_FIND_TARGET];
	const candidates = new Set<string>();

	const isCandidate = (candidatePath: string, targetPath: string): boolean => {
		const isDeepEnough =
			query.minimumDepth === undefined ||
			candidateDepth(candidatePath, targetPath) >= query.minimumDepth;

		return (
			isDeepEnough &&
			!isExcludedByQuery(candidatePath, query, workingDirectory) &&
			matchesNameFilter(candidatePath, query, workingDirectory, homeDirectory)
		);
	};

	for (const target of targets) {
		for (const absoluteTarget of resolveTokenPaths(target, workingDirectory, homeDirectory, options)) {
			const listedFiles = listDirectory(absoluteTarget, query.maximumDepth);

			for (const listedFile of listedFiles) {
				const candidatePath = normalizeAbs(listedFile);

				if (isCandidate(candidatePath, absoluteTarget)) candidates.add(candidatePath);
			}

			if (checkFileExists(absoluteTarget) && isCandidate(absoluteTarget, absoluteTarget)) {
				candidates.add(absoluteTarget);
			}
		}
	}

	return [...candidates];
}
