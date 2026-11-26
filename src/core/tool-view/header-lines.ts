import { formatCommandDuration } from "./duration.ts";
import { RowKind, rowLabelOf } from "./row-kind.ts";
import {
	BLANK,
	HINT_SEPARATOR,
	MARK_COLUMN_WIDTH,
	pluralize,
	SINGLE_ROW_COUNT,
	SPACE,
	summarizeIssues,
	toSingleLine,
	wordText,
	wordTone,
	type IssueSummary,
	type RowGroupSummary,
	type RowLine,
	type RowSpan,
	type RowSummary,
	type StyledText,
} from "./row-group-types.ts";
import { statusMark, ToolStatus } from "./status.ts";
import { fitPathTarget, fitTarget, shortenDisplayPath, summarizeShellCommand } from "./target-summary.ts";
import { thinkingPart } from "./thinking.ts";

const FOLDED_NOTE_BADGE = "[notice]";
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

export function headerStatus(summary: RowGroupSummary): ToolStatus {
	const lastStatus = summary.rows.at(-1)?.status ?? ToolStatus.Running;

	if (summary.thinking && lastStatus === ToolStatus.Ok) {
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
	const countPart = countText(summary);
	const issues = headerIssueSummary(summary.rows, status);
	const issuePart = issues ? `${SPACE}(${issues.label})` : BLANK;
	const thoughtPart = summary.thinking ? `${SPACE}${thinkingPart(summary.thinking)}` : BLANK;
	const wordPart = wordText(status, hintsFolded || summary.rows.length === SINGLE_ROW_COUNT);
	const hasFoldedNotice = summary.folded && summary.rows.some((row) => Boolean(row.note));
	const noticePart = hasFoldedNotice ? `${SPACE}${FOLDED_NOTE_BADGE}` : BLANK;
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

	if (issues) {
		spans.push({ text: issuePart, tone: issues.tone });
	}

	if (targetPart) {
		for (const span of targetPartSpans(targetPart)) {
			spans.push(span);
		}
	}

	if (thoughtPart) {
		spans.push({ text: thoughtPart, tone: "thinking", italic: true });
	}

	if (wordPart) {
		spans.push({ text: wordPart, tone: wordTone(status) });
	}

	if (noticePart) {
		spans.push({ text: noticePart, tone: "warning" });
	}

	return {
		text: `${chevron}${countPart}${issuePart}${targetPart}${thoughtPart}${wordPart}${noticePart}`,
		spans,
	};
}

function headerIssueSummary(rows: readonly RowSummary[], status: ToolStatus): IssueSummary | undefined {
	if (status !== ToolStatus.Ok && status !== ToolStatus.Running) {
		return undefined;
	}

	return summarizeIssues(rows);
}

function countText(summary: RowGroupSummary): string {
	const label = rowLabelOf(summary.kind);
	const count = summary.rows.length;

	if (label.fixedTitle) {
		return label.fixedTitle;
	}

	return `${label.verb} ${count} ${pluralize(label.noun, count)}`;
}

function targetText(summary: RowGroupSummary, folded: boolean, availableWidth: number): string {
	const budget = availableWidth - TARGET_PARENTHESES_WIDTH;

	if (!folded || budget < MINIMUM_TARGET_WIDTH) {
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

function targetPartSpans(targetPart: string): RowSpan[] {
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

	return fitTarget(toSingleLine(target), budget);
}

function showsCommandNames(summary: RowGroupSummary): boolean {
	return summary.folded && summary.kind === RowKind.Shell && summary.rows.length > 1;
}

function namesText(summary: RowGroupSummary, budget: number): string {
	for (const withHints of [true, false]) {
		for (const limit of NAME_LIMITS) {
			const candidate = namesCandidate(summary, withHints, limit);

			if (candidate && candidate.length <= budget) {
				return `${SPACE}(${candidate})`;
			}
		}
	}

	const fullOverflow = `${OVERFLOW_PREFIX}${summary.rows.length}${MORE_SUFFIX}`;

	if (fullOverflow.length <= budget) {
		return `${SPACE}(${fullOverflow})`;
	}

	const compactOverflow = `${OVERFLOW_PREFIX}${summary.rows.length}`;

	return compactOverflow.length <= budget ? `${SPACE}(${compactOverflow})` : BLANK;
}

function namesCandidate(summary: RowGroupSummary, withHints: boolean, limit: number): string | undefined {
	const shown = Math.min(limit, summary.rows.length);

	if (shown === 0) {
		return undefined;
	}

	const names = summary.rows.slice(0, shown).map((row) => (withHints ? (row.hint ?? row.target) : row.target));

	const namesPart = names.join(NAME_SEPARATOR);
	const overflowCount = summary.rows.length - shown;

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
