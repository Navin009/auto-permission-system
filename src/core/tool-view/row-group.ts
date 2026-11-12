import { formatCommandDuration } from "./duration.ts";
import { RowKind, rowLabelOf } from "./row-kind.ts";
import { statusMark, statusWord, ToolStatus } from "./status.ts";
import { fitTarget, summarizeShellCommand } from "./target-summary.ts";
import { thinkingPart, type ThinkingState } from "./thinking.ts";

export interface RowSummary {
	target: string;
	status: ToolStatus;
	durationMilliseconds: number | undefined;
}

export interface RowGroupSummary {
	kind: RowKind;
	rows: readonly RowSummary[];
	durationMilliseconds: number | undefined;
	folded: boolean;
	hint: string | undefined;
	thinking: ThinkingState | undefined;
}

export interface RowMark {
	glyph: string;
	status: ToolStatus;
}

export interface RowLine {
	indent: string;
	mark: RowMark | undefined;
	text: string;
	hint: string | undefined;
	isDim: boolean;
}

const NEWEST_ROW_LIMIT = 8;
const SINGLE_ROW_COUNT = 1;
const EARLIER_CALL_NOUN = "call";
const LINE_INDENT = "  └ ";
const SHELL_PROMPT = "$";
const RUNNING_LINE_MARK = "…";
const OVERFLOW_MARK = "...";
const SPACE = " ";
const DURATION_SEPARATOR = " · ";
const PLURAL_ENDING = "s";
const PLURAL_Y_ENDING = "ies";
const WHITESPACE_PATTERN = /\s+/g;
const MARK_COLUMN_WIDTH = 2;
const TARGET_PARENTHESES_WIDTH = 3;
const MINIMUM_TARGET_WIDTH = 12;

export function rowGroupLines(summary: RowGroupSummary, width: number): RowLine[] {
	const showsChildLines = rowLabelOf(summary.kind).showsChildLines;
	const folded = summary.folded || !showsChildLines;
	const status = headerStatus(summary.rows, summary.thinking !== undefined);
	const lines = [headerLine(summary, status, folded, width)];

	if (folded) {
		return lines;
	}

	return [...lines, ...childLines(summary.rows)];
}

export function pluralize(noun: string, count: number): string {
	if (count === SINGLE_ROW_COUNT) {
		return noun;
	}

	return noun.endsWith("y") ? `${noun.slice(0, -1)}${PLURAL_Y_ENDING}` : `${noun}${PLURAL_ENDING}`;
}

function headerStatus(rows: readonly RowSummary[], isThinking: boolean): ToolStatus {
	const lastStatus = rows.at(-1)?.status ?? ToolStatus.Running;

	if (isThinking && lastStatus === ToolStatus.Ok) {
		return ToolStatus.Running;
	}

	return lastStatus;
}

function headerLine(
	summary: RowGroupSummary,
	status: ToolStatus,
	folded: boolean,
	width: number,
): RowLine {
	const hint = folded ? summary.hint : undefined;

	return {
		indent: "",
		mark: { glyph: statusMark(status), status },
		text: headerText(summary, status, folded, hint, width),
		hint,
		isDim: false,
	};
}

function headerText(
	summary: RowGroupSummary,
	status: ToolStatus,
	folded: boolean,
	hint: string | undefined,
	width: number,
): string {
	const countPart = countText(summary);
	const thoughtPart = summary.thinking ? `${SPACE}${thinkingPart(summary.thinking)}` : "";
	const durationPart = durationText(summary.durationMilliseconds);
	const wordPart = wordText(status, folded || summary.rows.length === SINGLE_ROW_COUNT);
	const hintPart = hintText(hint);
	const fixedWidth =
		MARK_COLUMN_WIDTH +
		countPart.length +
		thoughtPart.length +
		durationPart.length +
		wordPart.length +
		hintPart.length;
	const targetPart = targetText(summary, folded, width - fixedWidth);

	return `${countPart}${targetPart}${thoughtPart}${durationPart}${wordPart}`;
}

function countText(summary: RowGroupSummary): string {
	const label = rowLabelOf(summary.kind);
	const count = summary.rows.length;

	return `${label.verb} ${count} ${pluralize(label.noun, count)}`;
}

function targetText(summary: RowGroupSummary, folded: boolean, availableWidth: number): string {
	const target = folded ? summary.rows.at(-1)?.target : undefined;
	const budget = availableWidth - TARGET_PARENTHESES_WIDTH;

	if (!target || budget < MINIMUM_TARGET_WIDTH) {
		return "";
	}

	const label = summary.kind === RowKind.Shell ? summarizeShellCommand(target) : toSingleLine(target);
	const fitted = fitTarget(label, budget);

	return fitted ? `${SPACE}(${fitted})` : "";
}

function hintText(hint: string | undefined): string {
	return hint ? `${SPACE}${hint}` : "";
}

function durationText(durationMilliseconds: number | undefined): string {
	if (durationMilliseconds === undefined) {
		return "";
	}

	return `${DURATION_SEPARATOR}${formatCommandDuration(durationMilliseconds)}`;
}

function wordText(status: ToolStatus, isShown: boolean): string {
	const word = isShown ? statusWord(status) : undefined;

	return word ? `${SPACE}${word}` : "";
}

function childLines(rows: readonly RowSummary[]): RowLine[] {
	const hiddenCount = Math.max(0, rows.length - NEWEST_ROW_LIMIT);
	const visibleRows = hiddenCount > 0 ? rows.slice(hiddenCount) : rows;
	const lines = hiddenCount > 0 ? [overflowLine(hiddenCount)] : [];
	const isSingle = rows.length === SINGLE_ROW_COUNT;

	for (const row of visibleRows) {
		lines.push(childLine(row, isSingle));
	}

	return lines;
}

function childLine(row: RowSummary, isSingle: boolean): RowLine {
	return {
		indent: LINE_INDENT,
		mark: isSingle ? undefined : { glyph: childMark(row.status), status: row.status },
		text: childLineText(row, isSingle),
		hint: undefined,
		isDim: true,
	};
}

function childMark(status: ToolStatus): string {
	return status === ToolStatus.Running ? RUNNING_LINE_MARK : statusMark(status);
}

function childLineText(row: RowSummary, isSingle: boolean): string {
	const targetPart = `${SHELL_PROMPT}${SPACE}${toSingleLine(row.target)}`;

	if (isSingle) {
		return targetPart;
	}

	const duration = row.status === ToolStatus.Running ? undefined : row.durationMilliseconds;
	const durationPart = duration === undefined ? "" : `${SPACE}${formatCommandDuration(duration)}`;

	return `${targetPart}${durationPart}${wordText(row.status, true)}`;
}

function overflowLine(hiddenCount: number): RowLine {
	return {
		indent: LINE_INDENT,
		mark: undefined,
		text: `${OVERFLOW_MARK} (${hiddenCount} earlier ${pluralize(EARLIER_CALL_NOUN, hiddenCount)})`,
		hint: undefined,
		isDim: true,
	};
}

function toSingleLine(text: string): string {
	return text.replace(WHITESPACE_PATTERN, " ").trim();
}
