/**
 * Per-command operand grammar for the read pre-flight (ADR-050).
 *
 * After a search command the first free word is a PATTERN, not a file: `grep
 * -v '\.env'` filters text and opens nothing, yet the pattern resolved to the
 * project's `.env` and asked to read it. `find` already has its own grammar
 * (ADR-049); this is the same idea for the pattern-first commands.
 *
 * Only the search family gets a grammar here. An interpreter or a `sed` script
 * is different on purpose: `node -e "readFileSync('.env')"` really does open
 * the file, so its text stays a candidate source (path-tokens.ts drops the
 * regex-shaped fragments that are not paths).
 *
 * Pure: no filesystem access.
 */

const FLAG_PATTERN = /^-./;
const DASH = "-";
const INLINE_LONG_VALUE = "=";
const SHORT_FLAG_LENGTH = 2;

/** Heads whose first free operand is a search pattern, not a file. */
const PATTERN_HEADS = new Set(["grep", "egrep", "fgrep", "rg", "ag", "ack", "ack-grep"]);

/** Flags whose value is the pattern, so no free operand is one. */
const PATTERN_VALUE_FLAGS = new Set(["-e", "--regexp", "--expression", "-f", "--file"]);

/** Flags whose value is never a path (counts, types, globs, colours). */
const NON_PATH_VALUE_FLAGS = new Set([
	"-A",
	"-B",
	"-C",
	"-E",
	"-F",
	"-G",
	"-P",
	"-Z",
	"-d",
	"-g",
	"-j",
	"-m",
	"-t",
	"--after-context",
	"--before-context",
	"--color",
	"--colors",
	"--colour",
	"--column",
	"--context",
	"--context-separator",
	"--encoding",
	"--engine",
	"--exclude",
	"--exclude-dir",
	"--glob",
	"--iglob",
	"--include",
	"--max-count",
	"--max-depth",
	"--maxdepth",
	"--null",
	"--null-data",
	"--threads",
	"--type",
	"--type-not",
]);

function isFlag(token: string): boolean {
	return FLAG_PATTERN.test(token);
}

/** `-m5` / `--glob=*.env` carry their value in the same token. */
function hasInlineValue(token: string): boolean {
	return token.startsWith("--") ? token.includes(INLINE_LONG_VALUE) : token.length > SHORT_FLAG_LENGTH;
}

/** True when this command's operands need the pattern grammar. */
export function hasPatternOperand(head: string): boolean {
	return PATTERN_HEADS.has(head);
}

/**
 * The operands of one command segment that can name a file the command opens.
 *
 * `operands` is everything after the command head. For a search command the
 * flags, their values and the pattern are dropped, so a regex such as
 * `'\.env'` can never become a path.
 */
export function readTargetTokens(head: string, operands: readonly string[]): string[] {
	if (!hasPatternOperand(head)) return [...operands];

	const targets: string[] = [];
	let isPatternSuppliedByFlag = false;
	let isFreeOperandSeen = false;
	let position = 0;

	while (position < operands.length) {
		const token = operands[position];

		if (isFlag(token) && token !== DASH) {
			const takesValue = PATTERN_VALUE_FLAGS.has(token) || NON_PATH_VALUE_FLAGS.has(token);
			const skipsValue = takesValue && !hasInlineValue(token);

			if (PATTERN_VALUE_FLAGS.has(token)) isPatternSuppliedByFlag = true;

			position += skipsValue ? 2 : 1;
			continue;
		}

		if (!isPatternSuppliedByFlag && !isFreeOperandSeen) {
			isFreeOperandSeen = true;
			position++;
			continue;
		}

		targets.push(token);
		position++;
	}

	return targets;
}
