import { formatCommandDuration } from "./duration.ts";
import { RowKind, rowLabelOf } from "./row-kind.ts";
import {
	activeIssueSummary,
	BLANK,
	codemodeCallEntries,
	FOLDED_NOTE_BADGE,
	hasAnyNote,
	HINT_SEPARATOR,
	isMixedBatch,
	MARK_COLUMN_WIDTH,
	pluralize,
	rowEffectiveKind,
	SINGLE_ROW_COUNT,
	SPACE,
	toSingleLine,
	wordText,
	wordTone,
	type IssueSummary,
	type RowGroupSummary,
	type RowLine,
	type RowSpan,
	type StyledText,
} from "./row-group-types.ts";
import { statusMark, ToolStatus } from "./status.ts";
import { fitPathTarget, fitTarget, shortenDisplayPath, summarizeShellCommand } from "./target-summary.ts";
import { thinkingPart } from "./thinking.ts";

const FOLDED_CHEVRON = "▸ ";
const OPEN_CHEVRON = "▾ ";
const HEADER_DURATION_SEPARATOR = "· ";
const TARGET_PARENTHESES_WIDTH = 3;
const MINIMUM_TARGET_WIDTH = 4;
const NAME_LIMITS: readonly number[] = [4, 3, 2, 1];
const NAME_SEPARATOR = ", ";
const OVERFLOW_PREFIX = "+";
const MORE_SUFFIX = " more";
const OVERFLOW_TRAILING_PATTERN = /(, \+\d+ more)\)$/;
const ACTION_NOUN = "action";
const COMMAND_NOUN = "command";
const FILE_NOUN = "file";
const SCRIPT_NOUN = "script";
const CALL_NOUN = "call";
const COUNT_SEPARATOR = " · ";

export function headerStatus(summary: RowGroupSummary): ToolStatus {
	const hasRunning = summary.rows.some((row) => row.status === ToolStatus.Running);
	const lastStatus = summary.rows.at(-1)?.status ?? ToolStatus.Running;

	if (hasRunning || (summary.thinking && lastStatus === ToolStatus.Ok)) {
		return ToolStatus.Running;
	}

	return lastStatus;
}

export function buildHeaderLine(
	summary: RowGroupSummary,
	status: ToolStatus,
	hintsFolded: boolean,
	width: number,
): RowLine {
	const hint = headerHint(summary, hintsFolded);
	const duration = headerDuration(summary.durationMilliseconds);
	const tail = tailWidth(hint, duration);
	const styled = headerText(summary, status, hintsFolded, width - tail);

	return {
		indent: BLANK,
		mark: { glyph: statusMark(status, summary.spinnerFrame), status },
		text: styled.text,
		spans: styled.spans,
		duration,
		hint,
		isDim: false,
	};
}

function headerHint(summary: RowGroupSummary, hintsFolded: boolean): string | undefined {
	if (hintsFolded && !showsCommandNames(summary)) {
		return summary.hint;
	}

	if (!summary.folded && summary.groupOpenHint) {
		return summary.groupOpenHint;
	}

	return undefined;
}

function headerText(summary: RowGroupSummary, status: ToolStatus, hintsFolded: boolean, width: number): StyledText {
	const chevron = summary.folded ? FOLDED_CHEVRON : OPEN_CHEVRON;
	const countPart = countText(summary, status);
	const issues = activeIssueSummary(summary.rows, status);
	const issuePart = issues ? `${SPACE}(${issues.label})` : BLANK;
	const thoughtPart = summary.thinking ? `${SPACE}${thinkingPart(summary.thinking)}` : BLANK;
	const wordPart = wordText(status, hintsFolded || summary.rows.length === SINGLE_ROW_COUNT);
	const noticePart = summary.folded && hasAnyNote(summary.rows) ? `${SPACE}${FOLDED_NOTE_BADGE}` : BLANK;
	const fixedWidth =
		MARK_COLUMN_WIDTH +
		chevron.length +
		countPart.length +
		issuePart.length +
		thoughtPart.length +
		wordPart.length +
		noticePart.length;
	const targetPart = targetText(summary, summary.folded, width - fixedWidth);
	const spans: RowSpan[] = [
		{ text: chevron, tone: "dim" },
		{ text: countPart, tone: "title", bold: true },
	];

	appendSummaryTailSpans(spans, { issues, issuePart, targetPart, thoughtPart, wordPart, status, noticePart });

	return {
		text: `${chevron}${countPart}${issuePart}${targetPart}${thoughtPart}${wordPart}${noticePart}`,
		spans,
	};
}

export function appendSummaryTailSpans(
	spans: RowSpan[],
	parts: {
		issues: IssueSummary | undefined;
		issuePart: string;
		targetPart: string;
		thoughtPart?: string;
		wordPart: string;
		status: ToolStatus;
		noticePart: string;
	},
): void {
	if (parts.issues) {
		spans.push({ text: parts.issuePart, tone: parts.issues.tone });
	}

	if (parts.targetPart) {
		for (const span of targetPartSpans(parts.targetPart)) {
			spans.push(span);
		}
	}

	if (parts.thoughtPart) {
		spans.push({ text: parts.thoughtPart, tone: "thinking", italic: true });
	}

	if (parts.wordPart) {
		spans.push({ text: parts.wordPart, tone: wordTone(parts.status) });
	}

	if (parts.noticePart) {
		spans.push({ text: parts.noticePart, tone: "warning" });
	}
}

function countText(summary: RowGroupSummary, status: ToolStatus): string {
	if (isMixedBatch(summary)) {
		return mixedCountText(summary, status);
	}

	const label = rowLabelOf(summary.kind);
	const count = summary.rows.length;

	if (label.fixedTitle) {
		return label.fixedTitle;
	}

	return `${label.verb} ${count} ${pluralize(label.noun, count)}`;
}

function mixedCountText(summary: RowGroupSummary, status: ToolStatus): string {
	const counts = kindCounts(summary);

	if (summary.folded) {
		const isRunning = status === ToolStatus.Running;
		const phrases = counts.map(([kind, count]) => mixedFoldedPhrase(kind, count, isRunning));

		return capitalizeFirst(phrases.join(NAME_SEPARATOR));
	}

	const nounParts = counts.map(([kind, count]) => mixedNounCount(kind, count));

	return `${summary.rows.length} ${pluralize(ACTION_NOUN, summary.rows.length)} (${nounParts.join(NAME_SEPARATOR)})`;
}

function kindCounts(summary: RowGroupSummary): Array<[RowKind, number]> {
	const counts = new Map<RowKind, number>();

	for (const row of summary.rows) {
		const kind = rowEffectiveKind(summary, row);

		counts.set(kind, (counts.get(kind) ?? 0) + 1);
	}

	return [...counts.entries()];
}

function mixedFoldedPhrase(kind: RowKind, count: number, isRunning: boolean): string {
	if (kind === RowKind.Shell) {
		return `${isRunning ? "running" : "ran"} ${count} ${pluralize(COMMAND_NOUN, count)}`;
	}

	return `${isRunning ? "reading" : "read"} ${count} ${pluralize(FILE_NOUN, count)}`;
}

function mixedNounCount(kind: RowKind, count: number): string {
	const noun = kind === RowKind.Shell ? COMMAND_NOUN : FILE_NOUN;

	return `${count} ${pluralize(noun, count)}`;
}

function capitalizeFirst(text: string): string {
	return text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

function targetText(summary: RowGroupSummary, folded: boolean, availableWidth: number): string {
	const budget = availableWidth - TARGET_PARENTHESES_WIDTH;

	if (!folded || isMixedBatch(summary) || budget < MINIMUM_TARGET_WIDTH) {
		return BLANK;
	}

	if (showsCommandNames(summary)) {
		return namesText(summary, budget);
	}

	const target = summary.rows.at(-1)?.target;

	if (!target) {
		return BLANK;
	}

	const fitted = fitFoldedTarget(summary, target, budget);

	return fitted ? `${SPACE}(${fitted})` : BLANK;
}

export function targetPartSpans(targetPart: string): RowSpan[] {
	const match = OVERFLOW_TRAILING_PATTERN.exec(targetPart);

	if (!match || match.index === undefined) {
		return [{ text: targetPart, tone: "muted" }];
	}

	const prefix = targetPart.slice(0, match.index);

	return [
		{ text: prefix, tone: "muted" },
		{ text: match[1], tone: "dim" },
		{ text: ")", tone: "muted" },
	];
}

function fitFoldedTarget(summary: RowGroupSummary, target: string, budget: number): string | undefined {
	if (summary.kind === RowKind.Shell) {
		return fitTarget(summarizeShellCommand(target), budget);
	}

	if (summary.kind === RowKind.Read) {
		const normalized = shortenDisplayPath(toSingleLine(target), summary.cwd, summary.homeDirectory);

		return fitPathTarget(normalized, budget);
	}

	if (summary.kind === RowKind.Codemode) {
		return fitCodemodeFoldedTarget(summary, target, budget);
	}

	return fitTarget(toSingleLine(target), budget);
}

function fitCodemodeFoldedTarget(summary: RowGroupSummary, target: string, budget: number): string | undefined {
	const totalCalls = summary.rows.reduce((sum, row) => sum + codemodeCallEntries(row.subLines).length, 0);

	if (totalCalls === 0) {
		return fitTarget(toSingleLine(target), budget);
	}

	const scriptsPart = `${summary.rows.length} ${pluralize(SCRIPT_NOUN, summary.rows.length)}`;
	const callsPart = `${totalCalls} ${pluralize(CALL_NOUN, totalCalls)}`;

	return fitTarget(`${scriptsPart}${COUNT_SEPARATOR}${callsPart}`, budget);
}

function showsCommandNames(summary: RowGroupSummary): boolean {
	return summary.folded && !isMixedBatch(summary) && summary.kind === RowKind.Shell && summary.rows.length > 1;
}

function namesText(summary: RowGroupSummary, budget: number): string {
	for (const withHints of [true, false]) {
		const names = summary.rows.map((row) => (withHints ? (row.hint ?? row.target) : row.target));

		for (const limit of NAME_LIMITS) {
			const candidate = namesListCandidate(names, limit);

			if (candidate && candidate.length <= budget) {
				return `${SPACE}(${candidate})`;
			}
		}
	}

	return overflowOnlyText(summary.rows.length, budget);
}

export function fittedNamesList(
	names: readonly string[],
	availableWidth: number,
	limits: readonly number[] = NAME_LIMITS,
): string {
	const budget = availableWidth - TARGET_PARENTHESES_WIDTH;
	const fitted = fitCommaList(names, budget, limits);

	return fitted ? `${SPACE}(${fitted})` : BLANK;
}

export function fitCommaList(
	names: readonly string[],
	budget: number,
	limits: readonly number[] = NAME_LIMITS,
): string | undefined {
	if (budget < MINIMUM_TARGET_WIDTH || names.length === 0) {
		return undefined;
	}

	for (const limit of limits) {
		const candidate = namesListCandidate(names, limit);

		if (candidate && candidate.length <= budget) {
			return candidate;
		}
	}

	const fullOverflow = `${OVERFLOW_PREFIX}${names.length}${MORE_SUFFIX}`;

	if (fullOverflow.length <= budget) {
		return fullOverflow;
	}

	const compactOverflow = `${OVERFLOW_PREFIX}${names.length}`;

	return compactOverflow.length <= budget ? compactOverflow : undefined;
}

function overflowOnlyText(totalCount: number, budget: number): string {
	const fullOverflow = `${OVERFLOW_PREFIX}${totalCount}${MORE_SUFFIX}`;

	if (fullOverflow.length <= budget) {
		return `${SPACE}(${fullOverflow})`;
	}

	const compactOverflow = `${OVERFLOW_PREFIX}${totalCount}`;

	return compactOverflow.length <= budget ? `${SPACE}(${compactOverflow})` : BLANK;
}

function namesListCandidate(names: readonly string[], limit: number): string | undefined {
	const shown = Math.min(limit, names.length);

	if (shown === 0) {
		return undefined;
	}

	const namesPart = names.slice(0, shown).join(NAME_SEPARATOR);
	const overflowCount = names.length - shown;

	if (overflowCount === 0) {
		return namesPart;
	}

	return `${namesPart}${NAME_SEPARATOR}${OVERFLOW_PREFIX}${overflowCount}${MORE_SUFFIX}`;
}

function headerDuration(durationMilliseconds: number | undefined): string | undefined {
	if (durationMilliseconds === undefined) {
		return undefined;
	}

	return `${HEADER_DURATION_SEPARATOR}${formatCommandDuration(durationMilliseconds)}`;
}

function tailWidth(hint: string | undefined, duration: string | undefined): number {
	if (!hint && !duration) {
		return 0;
	}

	if (hint && duration) {
		return HINT_SEPARATOR.length + hint.length + SPACE.length + duration.length;
	}

	if (hint) {
		return HINT_SEPARATOR.length + hint.length;
	}

	return SPACE.length + (duration?.length ?? 0);
}
