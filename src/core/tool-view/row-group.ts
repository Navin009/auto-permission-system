import { formatCommandDuration } from "./duration.ts";
import { RowKind, rowLabelOf } from "./row-kind.ts";
import { statusMark, statusWord, ToolStatus } from "./status.ts";
import { displayShellCommand, fitCommand, fitTarget, summarizeShellCommand } from "./target-summary.ts";
import { thinkingPart, type ThinkingState } from "./thinking.ts";

export interface RowSummary {
	target: string;
	status: ToolStatus;
	durationMilliseconds: number | undefined;
	segmentIndex: number;
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
	duration: string | undefined;
	hint: string | undefined;
	isDim: boolean;
	memberIndex?: number;
	segmentIndex?: number;
}

const NEWEST_ROW_LIMIT = 8;
const SINGLE_ROW_COUNT = 1;
const EARLIER_CALL_NOUN = "call";
const LINE_INDENT = "  └ ";
const SHELL_PROMPT = "$";
const RUNNING_LINE_MARK = "…";
const OVERFLOW_MARK = "...";
const ELLIPSIS = "…";
const SPACE = " ";
const HEADER_DURATION_SEPARATOR = "· ";
const PLURAL_ENDING = "s";
const PLURAL_Y_ENDING = "ies";
const WHITESPACE_PATTERN = /\s+/g;
const BLANK = "";
const MARK_COLUMN_WIDTH = 2;
const TARGET_PARENTHESES_WIDTH = 3;
const MINIMUM_TARGET_WIDTH = 12;
const COMMAND_COLUMN_PERCENT = 70;
const PERCENT = 100;
const DRAWING_MEMBER_INDEX = 0;

export function rowGroupLines(summary: RowGroupSummary, width: number): RowLine[] {
	const showsChildLines = rowLabelOf(summary.kind).showsChildLines;
	const foldedHint = summary.folded || !showsChildLines;
	const status = headerStatus(summary);
	const header = headerLine(summary, status, foldedHint, width);

	if (summary.folded) {
		return [header];
	}

	return [header, ...childLines(summary, width, showsChildLines)];
}

export function rowGroupLinesForMember(
	summary: RowGroupSummary,
	width: number,
	memberIndex: number,
): RowLine[] {
	return rowGroupLines(summary, width).filter(
		(line) => (line.memberIndex ?? DRAWING_MEMBER_INDEX) === memberIndex,
	);
}

export function rowGroupLinesForSegment(
	summary: RowGroupSummary,
	width: number,
	segmentIndex: number,
): RowLine[] {
	return rowGroupLines(summary, width).filter(
		(line) => (line.segmentIndex ?? DRAWING_MEMBER_INDEX) === segmentIndex,
	);
}

export function pluralize(noun: string, count: number): string {
	if (count === SINGLE_ROW_COUNT) {
		return noun;
	}

	return noun.endsWith("y") ? `${noun.slice(0, -1)}${PLURAL_Y_ENDING}` : `${noun}${PLURAL_ENDING}`;
}

function markColumnWidth(mark: RowMark | undefined): number {
	return mark ? MARK_COLUMN_WIDTH : 0;
}

function headerStatus(summary: RowGroupSummary): ToolStatus {
	const lastStatus = summary.rows.at(-1)?.status ?? ToolStatus.Running;

	if (summary.thinking && lastStatus === ToolStatus.Ok) {
		return ToolStatus.Running;
	}

	return lastStatus;
}

function headerLine(
	summary: RowGroupSummary,
	status: ToolStatus,
	hintsFolded: boolean,
	width: number,
): RowLine {
	const hint = hintsFolded ? summary.hint : undefined;
	const duration = headerDuration(summary.durationMilliseconds);
	const tail = tailWidth(hint, duration);

	return {
		indent: BLANK,
		mark: { glyph: statusMark(status), status },
		text: headerText(summary, status, hintsFolded, width - tail),
		duration,
		hint,
		isDim: false,
	};
}

function headerText(
	summary: RowGroupSummary,
	status: ToolStatus,
	hintsFolded: boolean,
	width: number,
): string {
	const countPart = countText(summary);
	const thoughtPart = summary.thinking ? `${SPACE}${thinkingPart(summary.thinking)}` : "";
	const wordPart = wordText(status, hintsFolded || summary.rows.length === SINGLE_ROW_COUNT);
	const fixedWidth = MARK_COLUMN_WIDTH + countPart.length + thoughtPart.length + wordPart.length;
	const targetPart = targetText(summary, summary.folded, width - fixedWidth);

	return `${countPart}${targetPart}${thoughtPart}${wordPart}`;
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
		return BLANK;
	}

	const label = summary.kind === RowKind.Shell ? summarizeShellCommand(target) : toSingleLine(target);
	const fitted = fitTarget(label, budget);

	return fitted ? `${SPACE}(${fitted})` : BLANK;
}

function headerDuration(durationMilliseconds: number | undefined): string | undefined {
	if (durationMilliseconds === undefined) {
		return undefined;
	}

	return `${HEADER_DURATION_SEPARATOR}${formatCommandDuration(durationMilliseconds)}`;
}

function tailWidth(hint: string | undefined, duration: string | undefined): number {
	if (!hint || !duration) {
		const onlyPart = hint ?? duration;

		return onlyPart ? onlyPart.length + SPACE.length : 0;
	}

	return hint.length + duration.length + SPACE.length * 2;
}

function wordText(status: ToolStatus, isShown: boolean): string {
	const word = isShown ? statusWord(status) : undefined;

	return word ? `${SPACE}${word}` : BLANK;
}

function childLines(summary: RowGroupSummary, width: number, showsChildLines: boolean): RowLine[] {
	if (!showsChildLines) {
		return [];
	}

	const isSingle = summary.rows.length === SINGLE_ROW_COUNT;
	const childColumn = childColumnWidth(width);
	const visibleRows = newestRows(summary.rows);
	const hiddenCount = summary.rows.length - visibleRows.length;
	const lines = hiddenCount > 0 ? [overflowLine(hiddenCount)] : [];

	visibleRows.forEach((row, offset) => {
		lines.push(
			childLine(summary.kind, row, isSingle, childColumn, hiddenCount + offset, row.segmentIndex),
		);
	});

	return lines;
}

function newestRows(rows: readonly RowSummary[]): readonly RowSummary[] {
	if (rows.length <= NEWEST_ROW_LIMIT) {
		return rows;
	}

	return rows.slice(rows.length - NEWEST_ROW_LIMIT);
}

function childLine(
	kind: RowKind,
	row: RowSummary,
	isSingle: boolean,
	childColumn: number,
	memberIndex: number,
	segmentIndex: number,
): RowLine {
	const mark = isSingle ? undefined : { glyph: childMark(row.status), status: row.status };
	const wordPart = isSingle ? BLANK : wordText(row.status, true);
	const budget = childColumn - LINE_INDENT.length - markColumnWidth(mark) - wordPart.length;

	return {
		indent: LINE_INDENT,
		mark,
		text: childLineText(kind, row, budget, wordPart),
		duration: childDuration(row, isSingle),
		hint: undefined,
		isDim: true,
		memberIndex,
		segmentIndex,
	};
}

function childMark(status: ToolStatus): string {
	return status === ToolStatus.Running ? RUNNING_LINE_MARK : statusMark(status);
}

function childLineText(kind: RowKind, row: RowSummary, budget: number, wordPart: string): string {
	const linePart = kind === RowKind.Shell ? shellLineText(row.target, budget) : readLineText(row.target, budget);

	return `${linePart}${wordPart}`;
}

function shellLineText(command: string, budget: number): string {
	const promptPart = `${SHELL_PROMPT}${SPACE}`;
	const commandPart = fitCommand(displayShellCommand(command), budget - promptPart.length);

	return `${promptPart}${commandPart}`;
}

function readLineText(target: string, budget: number): string {
	const path = toSingleLine(target);

	return fitTarget(path, budget) ?? ELLIPSIS;
}

function childDuration(row: RowSummary, isSingle: boolean): string | undefined {
	if (isSingle || row.status === ToolStatus.Running || row.durationMilliseconds === undefined) {
		return undefined;
	}

	return formatCommandDuration(row.durationMilliseconds);
}

function childColumnWidth(width: number): number {
	const scaled = Math.floor((width * COMMAND_COLUMN_PERCENT) / PERCENT);

	return Math.min(scaled, width);
}

function overflowLine(hiddenCount: number): RowLine {
	return {
		indent: LINE_INDENT,
		mark: undefined,
		text: `${OVERFLOW_MARK} (${hiddenCount} earlier ${pluralize(EARLIER_CALL_NOUN, hiddenCount)})`,
		duration: undefined,
		hint: undefined,
		isDim: true,
		memberIndex: DRAWING_MEMBER_INDEX,
	};
}

function toSingleLine(text: string): string {
	return text.replace(WHITESPACE_PATTERN, SPACE).trim();
}
