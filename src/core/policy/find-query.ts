import { matchesGlob, matchesPolicyPattern, normalizeAbs } from "./patterns.ts";
import { isDirectoryPath, listDirectoryFiles, resolveTokenPaths, type PathCandidateOptions } from "./path-tokens.ts";

const NAME_PREDICATE = "-name";
const INSENSITIVE_NAME_PREDICATE = "-iname";
const TYPE_PREDICATE = "-type";
const MAXIMUM_DEPTH_PREDICATE = "-maxdepth";
const MINIMUM_DEPTH_PREDICATE = "-mindepth";

const FILE_TYPE_DIRECTORY = "d";
const FILE_TYPE_REGULAR = "f";

/** `find`'s expression groups, in both the escaped and bare spelling. */
const GROUP_OPENERS = new Set(["(", "\\("]);
const GROUP_CLOSERS = new Set([")", "\\)"]);

/** A distributed expression is a product of its branches, so this bounds it. */
const MAXIMUM_CLAUSES = 64;

const NEGATION_PREDICATES = new Set(["-not", "!"]);
/** The spelling this module emits when it has to build a negation itself. */
const NEGATION_TOKEN = "-not";
const AND_PREDICATES = new Set(["-a", "-and"]);
const OR_PREDICATES = new Set(["-o", "-or"]);
const PATH_PREDICATES = new Set(["-path", "-wholename"]);

/** Predicates whose negation is an exclusion the candidate filter understands. */
const NEGATABLE_PREDICATES = new Set([NAME_PREDICATE, ...PATH_PREDICATES]);

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
	insensitiveNamePatterns: string[];
	excludedNames: string[];
	excludedPaths: string[];
	maximumDepth?: number;
	minimumDepth?: number;
	directoriesOnly: boolean;
	filesOnly: boolean;
}

function parseDepth(value: string | undefined): number | undefined {
	if (value === undefined || !DEPTH_VALUE_PATTERN.test(value)) return undefined;

	return Number(value);
}

function isTargetToken(token: string): boolean {
	return !token.startsWith("-") && !NEGATION_PREDICATES.has(token);
}

export function parseFindQuery(tokens: readonly string[]): FindQuery | undefined {
	const { targets, predicates } = splitLeadTargets(tokens);
	const namePatterns: string[] = [];
	const insensitiveNamePatterns: string[] = [];
	const excludedNames: string[] = [];
	const excludedPaths: string[] = [];
	let maximumDepth: number | undefined;
	let minimumDepth: number | undefined;
	let directoriesOnly = false;
	let filesOnly = false;
	let isNegated = false;
	let position = 0;

	while (position < predicates.length) {
		const predicate = predicates[position];

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

		const value = predicates[position + 1];

		if (value === undefined) return undefined;

		if (isNegated) {
			if (!PATH_PREDICATES.has(predicate) && predicate !== NAME_PREDICATE) return undefined;

			if (PATH_PREDICATES.has(predicate)) excludedPaths.push(value);
			if (predicate === NAME_PREDICATE) excludedNames.push(value);
		} else {
			if (predicate === NAME_PREDICATE) namePatterns.push(value);
			if (predicate === INSENSITIVE_NAME_PREDICATE) insensitiveNamePatterns.push(value);
			if (predicate === MAXIMUM_DEPTH_PREDICATE) maximumDepth = parseDepth(value);
			if (predicate === MINIMUM_DEPTH_PREDICATE) minimumDepth = parseDepth(value);

			if (predicate === TYPE_PREDICATE) {
				directoriesOnly = value === FILE_TYPE_DIRECTORY;
				filesOnly = value === FILE_TYPE_REGULAR;
			}
		}

		isNegated = false;
		position += 2;
	}

	return {
		targets,
		namePatterns,
		insensitiveNamePatterns,
		excludedNames,
		excludedPaths,
		maximumDepth,
		minimumDepth,
		directoriesOnly,
		filesOnly,
	};
}

function splitLeadTargets(tokens: readonly string[]): { targets: string[]; predicates: string[] } {
	let position = 0;

	while (position < tokens.length && isTargetToken(tokens[position])) position++;

	return { targets: tokens.slice(0, position), predicates: tokens.slice(position) };
}

/**
 * `find`'s expression is a disjunction of conjunctions. `find` prints a path
 * that satisfies ANY branch of an `-o`, while a filter OUTSIDE a group applies
 * to every branch inside it, so the branches are distributed:
 * `-type d \\( -name a -o -name b \\)` is read as `(d AND a) OR (d AND b)`.
 * A negation over a group cannot be distributed (`-not \\( a -o b \\)` is
 * `!a AND !b`); an expression that cannot be read exactly falls back to the
 * unfiltered walk, which over-approximates instead of guessing.
 */
interface Alternation {
	clauses: string[][];
	next: number;
}

function matchingCloser(tokens: readonly string[], start: number): number | undefined {
	let depth = 0;

	for (let position = start; position < tokens.length; position++) {
		if (GROUP_OPENERS.has(tokens[position])) {
			depth++;
			continue;
		}

		if (!GROUP_CLOSERS.has(tokens[position])) continue;

		depth--;

		if (depth === 0) return position;
	}

	return undefined;
}

function product(left: readonly string[][], right: readonly string[][]): string[][] | undefined {
	if (left.length * right.length > MAXIMUM_CLAUSES) return undefined;

	const combined: string[][] = [];

	for (const leftClause of left) {
		for (const rightClause of right) combined.push([...leftClause, ...rightClause]);
	}

	return combined;
}

function readGroup(tokens: readonly string[], start: number): Alternation | undefined {
	const closer = matchingCloser(tokens, start);

	if (closer === undefined) return undefined;

	const inner = readOr(tokens.slice(start + 1, closer), 0);

	if (!inner || inner.next !== closer - start - 1) return undefined;

	return { clauses: inner.clauses, next: closer + 1 };
}

/**
 * `-not \\( -path a -o -path b \\)` is De Morgan's `!a AND !b`, which a single
 * clause can express: every branch becomes another exclusion. A branch that is
 * itself a conjunction has no such form here, so it falls back instead.
 */
function readNegatedGroup(tokens: readonly string[], start: number): Alternation | undefined {
	const group = readGroup(tokens, start + 1);

	if (!group) return undefined;

	const negatedClause: string[] = [];

	for (const clause of group.clauses) {
		if (clause.length !== 2 || !NEGATABLE_PREDICATES.has(clause[0])) return undefined;

		negatedClause.push(NEGATION_TOKEN, clause[0], clause[1]);
	}

	return { clauses: [negatedClause], next: group.next };
}

function readPrimary(tokens: readonly string[], start: number): Alternation | undefined {
	const token = tokens[start];

	if (token === undefined) return undefined;

	if (GROUP_OPENERS.has(token)) return readGroup(tokens, start);

	if (GROUP_CLOSERS.has(token) || OR_PREDICATES.has(token) || AND_PREDICATES.has(token)) return undefined;

	if (NEGATION_PREDICATES.has(token)) {
		const negatedPredicate = tokens[start + 1];

		if (negatedPredicate === undefined) return undefined;

		if (GROUP_OPENERS.has(negatedPredicate)) return readNegatedGroup(tokens, start);

		const negatedEnd = VALUE_PREDICATES.has(negatedPredicate) ? start + 3 : start + 2;

		if (negatedEnd > tokens.length) return undefined;

		return { clauses: [tokens.slice(start, negatedEnd)], next: negatedEnd };
	}

	const clauseEnd = VALUE_PREDICATES.has(token) ? start + 2 : start + 1;

	if (clauseEnd > tokens.length) return undefined;

	return { clauses: [tokens.slice(start, clauseEnd)], next: clauseEnd };
}

function readAnd(tokens: readonly string[], start: number): Alternation | undefined {
	let accumulated = readPrimary(tokens, start);

	if (!accumulated) return undefined;

	let position = accumulated.next;

	while (position < tokens.length) {
		const token = tokens[position];

		if (OR_PREDICATES.has(token) || GROUP_CLOSERS.has(token)) break;

		const conjunction = readPrimary(tokens, AND_PREDICATES.has(token) ? position + 1 : position);

		if (!conjunction) return undefined;

		const distributed = product(accumulated.clauses, conjunction.clauses);

		if (!distributed) return undefined;

		accumulated = { clauses: distributed, next: conjunction.next };
		position = conjunction.next;
	}

	return accumulated;
}

function readOr(tokens: readonly string[], start: number): Alternation | undefined {
	const firstBranch = readAnd(tokens, start);

	if (!firstBranch) return undefined;

	const clauses = [...firstBranch.clauses];
	let position = firstBranch.next;

	while (OR_PREDICATES.has(tokens[position])) {
		const nextBranch = readAnd(tokens, position + 1);

		if (!nextBranch || clauses.length + nextBranch.clauses.length > MAXIMUM_CLAUSES) return undefined;

		clauses.push(...nextBranch.clauses);
		position = nextBranch.next;
	}

	return { clauses, next: position };
}

function splitAlternatives(predicates: readonly string[]): string[][] | undefined {
	if (!predicates.length) return [[]];

	const parsed = readOr(predicates, 0);

	if (!parsed || parsed.next !== predicates.length) return undefined;

	return parsed.clauses;
}

/**
 * Every branch of an `-o` as its own AND query, each carrying the same
 * targets. `undefined` means no branch is understood, which is the caller's
 * cue to fall back to the unfiltered walk.
 */
export function parseFindQueries(tokens: readonly string[]): FindQuery[] | undefined {
	const { targets, predicates } = splitLeadTargets(tokens);
	const clauses = splitAlternatives(predicates);

	if (!clauses) return undefined;

	const queries: FindQuery[] = [];

	for (const clause of clauses) {
		const query = parseFindQuery([...targets, ...clause]);

		if (!query) return undefined;

		queries.push(query);
	}

	return queries;
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
	const hasNameFilter = query.namePatterns.length > 0 || query.insensitiveNamePatterns.length > 0;

	if (!hasNameFilter) return true;

	const basename = candidatePath.slice(candidatePath.lastIndexOf("/") + 1);

	const isExactMatch = query.namePatterns.some((pattern) =>
		matchesPolicyPattern(candidatePath, pattern, workingDirectory, homeDirectory),
	);
	const isInsensitiveMatch = query.insensitiveNamePatterns.some((pattern) => matchesGlob(basename, pattern, true));

	return isExactMatch || isInsensitiveMatch;
}

/**
 * `-type` answers one stat per survivor. An unstattable path is kept: the
 * candidate list decides what is protected, so it must over-approximate.
 */
function matchesTypeFilter(
	candidatePath: string,
	query: FindQuery,
	isDirectory: (absolutePath: string) => boolean | undefined,
): boolean {
	if (!query.directoriesOnly && !query.filesOnly) return true;

	const knownDirectory = isDirectory(candidatePath);

	if (knownDirectory === undefined) return true;

	return query.directoriesOnly ? knownDirectory : !knownDirectory;
}

function candidatesForQuery(
	query: FindQuery,
	workingDirectory: string,
	homeDirectory: string,
	checkFileExists: (path: string) => boolean,
	options: PathCandidateOptions,
): string[] {
	const listDirectory = options.listDirectory ?? listDirectoryFiles;
	const isDirectory = options.isDirectory ?? isDirectoryPath;
	const targets = query.targets.length ? query.targets : [DEFAULT_FIND_TARGET];
	const candidates = new Set<string>();

	const isCandidate = (candidatePath: string, targetPath: string): boolean => {
		const isDeepEnough =
			query.minimumDepth === undefined || candidateDepth(candidatePath, targetPath) >= query.minimumDepth;

		return (
			isDeepEnough &&
			!isExcludedByQuery(candidatePath, query, workingDirectory) &&
			matchesNameFilter(candidatePath, query, workingDirectory, homeDirectory) &&
			matchesTypeFilter(candidatePath, query, isDirectory)
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

export function findReadCandidates(
	tokens: readonly string[],
	workingDirectory: string,
	homeDirectory: string,
	checkFileExists: (path: string) => boolean,
	options: PathCandidateOptions,
): string[] | undefined {
	const queries = parseFindQueries(tokens);

	if (!queries) return undefined;

	const candidates = new Set<string>();

	for (const query of queries) {
		for (const candidatePath of candidatesForQuery(query, workingDirectory, homeDirectory, checkFileExists, options)) {
			candidates.add(candidatePath);
		}
	}

	return [...candidates];
}
