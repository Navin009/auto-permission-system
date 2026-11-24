import { formatCommandDuration } from "./duration.ts";
import { RowKind, rowLabelOf } from "./row-kind.ts";
import { statusMark, statusWord, ToolStatus } from "./status.ts";
import {
	displayShellCommand,
	fitCommand,
	fitPathTarget,
	fitTarget,
	shortenDisplayPath,
	summarizeShellCommand,
} from "./target-summary.ts";
import { thinkingPart, type ThinkingState } from "./thinking.ts";

export type SpanTone = "title" | "text" | "muted" | "dim" | "thinking" | "accent" | "success" | "warning" | "error";

export interface RowSpan {
	text: string;
	tone: SpanTone;
	bold?: boolean;
	italic?: boolean;
}

export interface SubLineSummary {
	text: string;
	status: ToolStatus | undefined;
	kind?: "script" | "call";
	detail?: string;
}

export interface RowSummary {
	target: string;
	status: ToolStatus;
	segmentIndex: number;
	hint?: string;
	subLines?: readonly SubLineSummary[];
	note?: string;
}

export interface RowGroupSummary {
	kind: RowKind;
	rows: readonly RowSummary[];
	durationMilliseconds: number | undefined;
	folded: boolean;
	hint: string | undefined;
	thinking: ThinkingState | undefined;
	spinnerFrame?: number;
	cwd?: string;
	homeDirectory?: string;
	groupOpenHint?: string;
}

export interface RowMark {
	glyph: string;
	status: ToolStatus;
}

export interface RowLine {
	indent: string;
	mark: RowMark | undefined;
	text: string;
	spans?: readonly RowSpan[];
	duration: string | undefined;
	hint: string | undefined;
	isDim: boolean;
	isWarning?: boolean;
	memberIndex?: number;
	segmentIndex?: number;
}

interface StyledText {
	text: string;
	spans: RowSpan[];
}

interface IssueSummary {
	label: string;
	tone: SpanTone;
}

interface ChildLinePlacement {
	isSingle: boolean;
	isLastLine: boolean;
	childColumn: number;
	memberIndex: number;
	segmentIndex: number;
}

const NEWEST_ROW_LIMIT = 8;
const SUB_LINE_LIMIT = 8;
const SINGLE_ROW_COUNT = 1;
const EARLIER_CALL_NOUN = "call";
const EARLIER_INNER_CALL_NOUN = "inner call";
const FOLDED_NOTE_BADGE = "[notice]";
const MIDDLE_LINE_INDENT = "  ├ ";
const LAST_LINE_INDENT = "  └ ";
const MIDDLE_ROW_SPACER = "  │ ";
const LAST_ROW_SPACER = "    ";
const MARK_SPACER = "  ";
const SUB_BRANCH_MIDDLE = "├ ";
const SUB_BRANCH_PIPE = "│ ";
const SUB_BRANCH_LAST = "└ ";
const MIDDLE_NOTE_FIRST_INDENT = "  │   ";
const MIDDLE_NOTE_CONTINUATION_INDENT = "  │     ";
const LAST_NOTE_FIRST_INDENT = "      ";
const LAST_NOTE_CONTINUATION_INDENT = "        ";
const NOTE_ARROW = "↳ ";
const FOLDED_CHEVRON = "▸ ";
const OPEN_CHEVRON = "▾ ";
const SHELL_PROMPT = "$";
const OVERFLOW_MARK = "...";
const ELLIPSIS = "…";
const PATH_SEPARATOR = "/";
const SPACE = " ";
export const HINT_SEPARATOR = "   ";
const HEADER_DURATION_SEPARATOR = "· ";
const ISSUE_SEPARATOR = " · ";
const PLURAL_ENDING = "s";
const PLURAL_Y_ENDING = "ies";
const LINE_BREAK_PATTERN = /\r?\n/;
const WHITESPACE_PATTERN = /\s+/g;
const NEGATION_PREFIX = "!";
const MAX_RUNNING_SUB_LINES = 3;
const STAGE_NOUN = "stage";
const LINE_NOUN = "line";
const LINE_RANGE_PATTERN = /:\d+(?:-\d+)?$/;
const BLANK = "";
const MARK_COLUMN_WIDTH = 2;
const TARGET_PARENTHESES_WIDTH = 3;
const MINIMUM_TARGET_WIDTH = 4;
const NAME_LIMITS: readonly number[] = [4, 3, 2, 1];
const NAME_SEPARATOR = ", ";
const OVERFLOW_PREFIX = "+";
const MORE_SUFFIX = " more";
const OVERFLOW_TRAILING_PATTERN = /(, \+\d+ more)\)$/;
const PAIR_CHAIN_OPERATORS: readonly string[] = ["&&", "||"];
const SINGLE_CHAIN_OPERATORS: readonly string[] = ["|", ";"];
const QUOTE_CHARACTERS: readonly string[] = ["'", '"'];
const ESCAPE_CHARACTER = "\\";
const COMMAND_COLUMN_PERCENT = 70;
const WIDE_COLUMN_PERCENT = 85;
const WIDE_WIDTH_THRESHOLD = 100;
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

export function rowGroupLinesForMember(summary: RowGroupSummary, width: number, memberIndex: number): RowLine[] {
	return rowGroupLines(summary, width).filter((line) => (line.memberIndex ?? DRAWING_MEMBER_INDEX) === memberIndex);
}

export function rowGroupLinesForSegment(summary: RowGroupSummary, width: number, segmentIndex: number): RowLine[] {
	return rowGroupLines(summary, width).filter((line) => (line.segmentIndex ?? DRAWING_MEMBER_INDEX) === segmentIndex);
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

function headerLine(summary: RowGroupSummary, status: ToolStatus, hintsFolded: boolean, width: number): RowLine {
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

function summarizeIssues(rows: readonly RowSummary[]): IssueSummary | undefined {
	let failed = 0;
	let blocked = 0;
	let denied = 0;

	for (const row of rows) {
		if (row.status === ToolStatus.Failed) {
			failed += 1;
		} else if (row.status === ToolStatus.Blocked) {
			blocked += 1;
		} else if (row.status === ToolStatus.Denied) {
			denied += 1;
		}
	}

	const total = failed + blocked + denied;

	if (total === 0) {
		return undefined;
	}

	if (failed === total) {
		return { label: `${failed} failed`, tone: "error" };
	}

	if (blocked === total) {
		return { label: `${blocked} blocked`, tone: "warning" };
	}

	if (denied === total) {
		return { label: `${denied} denied`, tone: "error" };
	}

	return { label: `${total} ${pluralize("issue", total)}`, tone: "error" };
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

	return `${namesPart}${overflowText(overflowCount)}`;
}

function overflowText(hiddenCount: number): string {
	return `${NAME_SEPARATOR}${OVERFLOW_PREFIX}${hiddenCount}${MORE_SUFFIX}`;
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

function wordText(status: ToolStatus, isShown: boolean): string {
	const word = isShown ? statusWord(status) : undefined;

	return word ? `${SPACE}${word}` : BLANK;
}

function wordTone(status: ToolStatus): SpanTone {
	if (status === ToolStatus.Blocked) {
		return "warning";
	}

	return status === ToolStatus.Denied ? "error" : "text";
}

function childLines(summary: RowGroupSummary, width: number, showsChildLines: boolean): RowLine[] {
	if (!showsChildLines) {
		return [];
	}

	const isSingle = summary.rows.length === SINGLE_ROW_COUNT;
	const childColumn = childColumnWidth(width);
	const visibleRows = newestRows(summary.rows);
	const hiddenCount = summary.rows.length - visibleRows.length;
	const hiddenRows = summary.rows.slice(0, hiddenCount);
	const lines = hiddenRows.length > 0 ? [overflowLine(hiddenRows)] : [];

	visibleRows.forEach((row, offset) => {
		const memberIndex = hiddenCount + offset;
		const isLastRow = offset === visibleRows.length - 1;
		const placement: ChildLinePlacement = {
			isSingle,
			isLastLine: isLastRow,
			childColumn,
			memberIndex,
			segmentIndex: row.segmentIndex,
		};

		for (const line of memberChildLines(summary, row, placement, width)) {
			lines.push(line);
		}
	});

	return lines;
}

function newestRows(rows: readonly RowSummary[]): readonly RowSummary[] {
	if (rows.length <= NEWEST_ROW_LIMIT) {
		return rows;
	}

	return rows.slice(rows.length - NEWEST_ROW_LIMIT);
}

function memberChildLines(
	summary: RowGroupSummary,
	row: RowSummary,
	placement: ChildLinePlacement,
	width: number,
): RowLine[] {
	const subLines = row.subLines;
	const rowLines = subLines
		? buildSubLines(subLines, placement, summary.spinnerFrame)
		: buildMemberRowLines(summary, row, placement);

	return [...rowLines, ...noteLines(row, placement, width)];
}

function buildMemberRowLines(summary: RowGroupSummary, row: RowSummary, placement: ChildLinePlacement): RowLine[] {
	if (summary.kind === RowKind.Shell && row.status === ToolStatus.Running) {
		return runningShellLines(summary, row, placement);
	}

	return [childLine(summary, row, placement)];
}

function runningShellLines(summary: RowGroupSummary, row: RowSummary, placement: ChildLinePlacement): RowLine[] {
	const rawLines = nonEmptyLines(row.target);

	if (rawLines.length > 1) {
		return multilineRunningShellLines(summary, row, placement, rawLines);
	}

	const cleaned = displayShellCommand(row.target);
	const stages = extractChainStages(cleaned);

	if (stages.length <= 1) {
		return [childLine(summary, row, placement)];
	}

	return chainedRunningShellLines(summary, row, placement, stages);
}

function nonEmptyLines(text: string): string[] {
	return text
		.split(LINE_BREAK_PATTERN)
		.map((line) => line.replace(WHITESPACE_PATTERN, SPACE).trim())
		.filter(Boolean);
}

function multilineRunningShellLines(
	summary: RowGroupSummary,
	row: RowSummary,
	placement: ChildLinePlacement,
	rawLines: readonly string[],
): RowLine[] {
	const shown = rawLines.slice(0, MAX_RUNNING_SUB_LINES);
	const hiddenCount = rawLines.length - shown.length;
	const firstLine = childLineWithCommand({ summary, row, placement, commandText: shown[0], asProgramLine: true });
	const lines: RowLine[] = [firstLine];

	shown.slice(1).forEach((lineText, offset) => {
		const isFinalLine = offset === shown.length - 2;
		const connector = isFinalLine ? SUB_BRANCH_LAST : SUB_BRANCH_PIPE;
		const indent = subBranchIndent(placement, connector);
		const suffix =
			isFinalLine && hiddenCount > 0
				? `${HINT_SEPARATOR}(+${hiddenCount} ${pluralize(LINE_NOUN, hiddenCount)})`
				: BLANK;
		const budget = Math.max(1, placement.childColumn - indent.length - suffix.length);
		const fitted = fitPlainLine(lineText, budget);
		const spans: RowSpan[] = [{ text: fitted, tone: "muted" }];

		if (suffix) {
			spans.push({ text: suffix, tone: "dim" });
		}

		lines.push({
			indent,
			mark: undefined,
			text: `${fitted}${suffix}`,
			spans,
			duration: undefined,
			hint: undefined,
			isDim: true,
			memberIndex: placement.memberIndex,
			segmentIndex: placement.segmentIndex,
		});
	});

	return lines;
}

interface ChainStage {
	operator: string | undefined;
	command: string;
}

function extractChainStages(commandText: string): ChainStage[] {
	const rawSegments = splitShellOperatorSegments(commandText);
	const stages: ChainStage[] = [];
	let pendingOperator: string | undefined;

	for (const segment of rawSegments) {
		if (segment.isOperator) {
			pendingOperator = segment.text;
			continue;
		}

		const trimmed = segment.text.trim();

		if (!trimmed) {
			continue;
		}

		stages.push({ operator: pendingOperator, command: trimmed });
		pendingOperator = undefined;
	}

	return stages;
}

function chainedRunningShellLines(
	summary: RowGroupSummary,
	row: RowSummary,
	placement: ChildLinePlacement,
	stages: readonly ChainStage[],
): RowLine[] {
	const firstLine = childLineWithCommand({
		summary,
		row,
		placement,
		commandText: stages[0].command,
		asProgramLine: true,
	});

	if (stages.length <= MAX_RUNNING_SUB_LINES) {
		const tailLines = stages.slice(1).map((stage, offset) => {
			const isFinal = offset === stages.length - 2;

			return chainStageSubLine(stage, placement, isFinal ? SUB_BRANCH_LAST : SUB_BRANCH_MIDDLE);
		});

		return [firstLine, ...tailLines];
	}

	const skipped = stages.slice(1, stages.length - 1);
	const lastStage = stages.at(-1);

	if (!lastStage) {
		return [firstLine];
	}

	return [firstLine, chainSkippedSubLine(skipped, placement), chainStageSubLine(lastStage, placement, SUB_BRANCH_LAST)];
}

function chainStageSubLine(stage: ChainStage, placement: ChildLinePlacement, connector: string): RowLine {
	const indent = subBranchIndent(placement, connector);
	const operatorPrefix = stage.operator ? `${stage.operator}${SPACE}` : BLANK;
	const budget = Math.max(1, placement.childColumn - indent.length - operatorPrefix.length);
	const fitted = fitCommand(stage.command, budget);
	const spans: RowSpan[] = [];

	if (operatorPrefix) {
		spans.push({ text: operatorPrefix, tone: "dim" });
	}

	appendSegmentCommandSpans(spans, fitted, !fitted.startsWith(`${ELLIPSIS}${SPACE}`));

	return {
		indent,
		mark: undefined,
		text: `${operatorPrefix}${fitted}`,
		spans,
		duration: undefined,
		hint: undefined,
		isDim: true,
		memberIndex: placement.memberIndex,
		segmentIndex: placement.segmentIndex,
	};
}

function chainSkippedSubLine(skipped: readonly ChainStage[], placement: ChildLinePlacement): RowLine {
	const indent = subBranchIndent(placement, SUB_BRANCH_MIDDLE);
	const budget = Math.max(1, placement.childColumn - indent.length);
	const base = `${ELLIPSIS} (+${skipped.length} ${pluralize(STAGE_NOUN, skipped.length)}`;
	const names = skipped.map((stage) => stageProgramLabel(stage.command));
	const withNames = `${base}: ${names.join(NAME_SEPARATOR)})`;
	const text = withNames.length <= budget ? withNames : fitStageSkipText(base, names, budget);

	return {
		indent,
		mark: undefined,
		text,
		spans: [{ text, tone: "dim" }],
		duration: undefined,
		hint: undefined,
		isDim: true,
		memberIndex: placement.memberIndex,
		segmentIndex: placement.segmentIndex,
	};
}

function fitStageSkipText(base: string, names: readonly string[], budget: number): string {
	for (let count = names.length - 1; count >= 1; count -= 1) {
		const candidate = `${base}: ${names.slice(0, count).join(NAME_SEPARATOR)}, ${ELLIPSIS})`;

		if (candidate.length <= budget) {
			return candidate;
		}
	}

	const compact = `${base})`;

	return compact.length <= budget ? compact : fitPlainLine(compact, budget);
}

function stageProgramLabel(command: string): string {
	const tokens = command.trim().split(WHITESPACE_PATTERN);

	if (tokens[0] === NEGATION_PREFIX && tokens[1]) {
		return `${NEGATION_PREFIX}${SPACE}${tokens[1]}`;
	}

	return tokens[0] ?? BLANK;
}

function subBranchIndent(placement: ChildLinePlacement, connector: string): string {
	const rowSpacer = placement.isLastLine ? LAST_ROW_SPACER : MIDDLE_ROW_SPACER;
	const markSpacer = placement.isSingle ? BLANK : MARK_SPACER;

	return `${rowSpacer}${markSpacer}${connector}`;
}

function fitPlainLine(text: string, budget: number): string {
	if (text.length <= budget) {
		return text;
	}

	if (budget <= 1) {
		return ELLIPSIS;
	}

	return `${text.slice(0, budget - 1)}${ELLIPSIS}`;
}

interface ChildCommandLineInput {
	summary: RowGroupSummary;
	row: RowSummary;
	placement: ChildLinePlacement;
	commandText: string;
	asProgramLine: boolean;
}

function childLineWithCommand(input: ChildCommandLineInput): RowLine {
	const { summary, row, placement, commandText, asProgramLine } = input;
	const indent = placement.isLastLine ? LAST_LINE_INDENT : MIDDLE_LINE_INDENT;
	const mark = placement.isSingle
		? undefined
		: { glyph: statusMark(row.status, summary.spinnerFrame), status: row.status };
	const wordPart = placement.isSingle ? BLANK : wordText(row.status, true);
	const budget = placement.childColumn - indent.length - markColumnWidth(mark) - wordPart.length;
	const promptPart = `${SHELL_PROMPT}${SPACE}`;
	const commandBudget = Math.max(1, budget - promptPart.length);
	const fitted = asProgramLine ? fitCommand(commandText, commandBudget) : fitPlainLine(commandText, commandBudget);
	const spans: RowSpan[] = [{ text: promptPart, tone: "dim" }];

	if (fitted.startsWith(`${ELLIPSIS}${SPACE}`) || !asProgramLine) {
		appendShellCommandSpans(spans, fitted, asProgramLine && !fitted.startsWith(`${ELLIPSIS}${SPACE}`));
	} else {
		appendSegmentCommandSpans(spans, fitted, true);
	}

	if (wordPart) {
		spans.push({ text: wordPart, tone: wordTone(row.status) });
	}

	return {
		indent,
		mark,
		text: `${promptPart}${fitted}${wordPart}`,
		spans,
		duration: undefined,
		hint: undefined,
		isDim: true,
		memberIndex: placement.memberIndex,
		segmentIndex: placement.segmentIndex,
	};
}

function buildSubLines(
	subLines: readonly SubLineSummary[],
	placement: ChildLinePlacement,
	spinnerFrame: number | undefined,
): RowLine[] {
	if (subLines.length <= SUB_LINE_LIMIT) {
		return subLines.map((subLine, index) =>
			subLineLine(
				subLine,
				{ ...placement, isLastLine: placement.isLastLine && index === subLines.length - 1 },
				spinnerFrame,
			),
		);
	}

	const hasLeadingScript = subLines[0]?.kind === "script";
	const callEntries = hasLeadingScript ? subLines.slice(1) : subLines;
	const callKeepLimit = hasLeadingScript ? SUB_LINE_LIMIT - 1 : SUB_LINE_LIMIT;
	const visibleCalls = callEntries.slice(callEntries.length - callKeepLimit);
	const hiddenCount = callEntries.length - visibleCalls.length;
	const lines: RowLine[] = [];

	if (hasLeadingScript) {
		lines.push(subLineLine(subLines[0], { ...placement, isLastLine: false }, spinnerFrame));
	}

	if (hiddenCount > 0) {
		lines.push(subLineOverflowLine(hiddenCount, placement));
	}

	visibleCalls.forEach((subLine, index) => {
		const isLastLine = placement.isLastLine && index === visibleCalls.length - 1;

		lines.push(subLineLine(subLine, { ...placement, isLastLine }, spinnerFrame));
	});

	return lines;
}

function subLineOverflowLine(hiddenCount: number, placement: ChildLinePlacement): RowLine {
	const text = `${OVERFLOW_MARK} (${hiddenCount} earlier ${pluralize(EARLIER_INNER_CALL_NOUN, hiddenCount)})`;

	return {
		indent: MIDDLE_LINE_INDENT,
		mark: undefined,
		text,
		spans: [{ text, tone: "dim" }],
		duration: undefined,
		hint: undefined,
		isDim: true,
		memberIndex: placement.memberIndex,
		segmentIndex: placement.segmentIndex,
	};
}

function noteLines(row: RowSummary, placement: ChildLinePlacement, width: number): RowLine[] {
	if (!row.note) {
		return [];
	}

	const firstIndent = placement.isLastLine ? LAST_NOTE_FIRST_INDENT : MIDDLE_NOTE_FIRST_INDENT;
	const continuationIndent = placement.isLastLine ? LAST_NOTE_CONTINUATION_INDENT : MIDDLE_NOTE_CONTINUATION_INDENT;
	const budget = Math.max(1, width - firstIndent.length - NOTE_ARROW.length);
	const wrapped = wrapText(toSingleLine(row.note), budget);

	return wrapped.map((chunk, index) => {
		const text = index === 0 ? `${NOTE_ARROW}${chunk}` : chunk;

		return {
			indent: index === 0 ? firstIndent : continuationIndent,
			mark: undefined,
			text,
			spans: [{ text, tone: "warning" }],
			duration: undefined,
			hint: undefined,
			isDim: false,
			isWarning: true,
			memberIndex: placement.memberIndex,
			segmentIndex: placement.segmentIndex,
		};
	});
}

function wrapText(text: string, budget: number): string[] {
	const lines: string[] = [];
	let currentLine = BLANK;

	for (const word of text.split(SPACE)) {
		const candidate = currentLine ? `${currentLine}${SPACE}${word}` : word;

		if (!currentLine || candidate.length <= budget) {
			currentLine = candidate;
			continue;
		}

		lines.push(currentLine);
		currentLine = word;
	}

	if (currentLine) {
		lines.push(currentLine);
	}

	return lines;
}

function subLineLine(
	subLine: SubLineSummary,
	placement: ChildLinePlacement,
	spinnerFrame: number | undefined,
): RowLine {
	const indent = placement.isLastLine ? LAST_LINE_INDENT : MIDDLE_LINE_INDENT;
	const mark = subLine.status ? { glyph: statusMark(subLine.status, spinnerFrame), status: subLine.status } : undefined;
	const budget = placement.childColumn - indent.length - markColumnWidth(mark);
	const fitted = fitTarget(subLine.text, budget) ?? ELLIPSIS;

	return {
		indent,
		mark,
		text: fitted,
		spans: subLineSpans(subLine, fitted),
		duration: undefined,
		hint: undefined,
		isDim: true,
		memberIndex: placement.memberIndex,
		segmentIndex: placement.segmentIndex,
	};
}

function subLineSpans(subLine: SubLineSummary, fitted: string): RowSpan[] {
	if (subLine.kind === "script") {
		return [{ text: fitted, tone: "dim", italic: true }];
	}

	if (subLine.kind === "call") {
		const detail = subLine.detail;

		if (detail && fitted.endsWith(`${SPACE}${detail}`)) {
			const namePart = fitted.slice(0, fitted.length - detail.length - SPACE.length);

			return [
				{ text: namePart, tone: "title" },
				{ text: `${SPACE}${detail}`, tone: "muted" },
			];
		}

		const spaceIndex = fitted.indexOf(SPACE);

		if (spaceIndex > 0) {
			return [
				{ text: fitted.slice(0, spaceIndex), tone: "title" },
				{ text: fitted.slice(spaceIndex), tone: "muted" },
			];
		}

		return [{ text: fitted, tone: "title" }];
	}

	return [{ text: fitted, tone: "muted" }];
}

function childLine(summary: RowGroupSummary, row: RowSummary, placement: ChildLinePlacement): RowLine {
	const indent = placement.isLastLine ? LAST_LINE_INDENT : MIDDLE_LINE_INDENT;
	const mark = placement.isSingle
		? undefined
		: { glyph: statusMark(row.status, summary.spinnerFrame), status: row.status };
	const wordPart = placement.isSingle ? BLANK : wordText(row.status, true);
	const budget = placement.childColumn - indent.length - markColumnWidth(mark) - wordPart.length;
	const styled = childLineText(summary, row, budget, wordPart);

	return {
		indent,
		mark,
		text: styled.text,
		spans: styled.spans,
		duration: undefined,
		hint: undefined,
		isDim: true,
		memberIndex: placement.memberIndex,
		segmentIndex: placement.segmentIndex,
	};
}

function childLineText(summary: RowGroupSummary, row: RowSummary, budget: number, wordPart: string): StyledText {
	if (summary.kind === RowKind.Shell) {
		return shellLineStyled(row.target, budget, wordPart, row.status);
	}

	return readLineStyled(summary, row, budget, wordPart);
}

function shellLineStyled(command: string, budget: number, wordPart: string, status: ToolStatus): StyledText {
	const promptPart = `${SHELL_PROMPT}${SPACE}`;
	const commandPart = fitCommand(displayShellCommand(command), budget - promptPart.length);
	const spans: RowSpan[] = [{ text: promptPart, tone: "dim" }];
	const truncatedPrefix = `${ELLIPSIS}${SPACE}`;

	if (commandPart.startsWith(truncatedPrefix)) {
		spans.push({ text: truncatedPrefix, tone: "dim" });
		appendShellCommandSpans(spans, commandPart.slice(truncatedPrefix.length), false);
	} else {
		appendShellCommandSpans(spans, commandPart, true);
	}

	if (wordPart) {
		spans.push({ text: wordPart, tone: wordTone(status) });
	}

	return {
		text: `${promptPart}${commandPart}${wordPart}`,
		spans,
	};
}

function appendShellCommandSpans(spans: RowSpan[], commandText: string, startsAtProgram: boolean): void {
	const segments = splitShellOperatorSegments(commandText);

	segments.forEach((segment, index) => {
		if (segment.isOperator) {
			spans.push({ text: segment.text, tone: "dim" });
			return;
		}

		const isProgramSegment = index > 0 || startsAtProgram;

		appendSegmentCommandSpans(spans, segment.text, isProgramSegment);
	});
}

function appendSegmentCommandSpans(spans: RowSpan[], segmentText: string, isProgramSegment: boolean): void {
	if (!isProgramSegment) {
		spans.push({ text: segmentText, tone: "muted" });
		return;
	}

	const leadingSpaces = segmentText.length - segmentText.trimStart().length;

	if (leadingSpaces > 0) {
		spans.push({ text: segmentText.slice(0, leadingSpaces), tone: "muted" });
	}

	const trimmed = segmentText.slice(leadingSpaces);
	const firstSpace = trimmed.indexOf(SPACE);

	if (firstSpace > 0) {
		spans.push({ text: trimmed.slice(0, firstSpace), tone: "text" });
		spans.push({ text: trimmed.slice(firstSpace), tone: "muted" });
		return;
	}

	if (trimmed) {
		spans.push({ text: trimmed, tone: "text" });
	}
}

function splitShellOperatorSegments(text: string): Array<{ text: string; isOperator: boolean }> {
	const segments: Array<{ text: string; isOperator: boolean }> = [];
	let currentStart = 0;
	let openQuote = "";
	let index = 0;

	while (index < text.length) {
		const character = text[index];

		if (openQuote) {
			if (character === ESCAPE_CHARACTER) {
				index += 2;
				continue;
			}

			if (character === openQuote) {
				openQuote = "";
			}

			index += 1;
			continue;
		}

		if (QUOTE_CHARACTERS.includes(character)) {
			openQuote = character;
			index += 1;
			continue;
		}

		const operatorLength = chainOperatorLengthAt(text, index);

		if (operatorLength === 0) {
			index += 1;
			continue;
		}

		if (index > currentStart) {
			segments.push({ text: text.slice(currentStart, index), isOperator: false });
		}

		segments.push({ text: text.slice(index, index + operatorLength), isOperator: true });
		index += operatorLength;
		currentStart = index;
	}

	if (currentStart < text.length) {
		segments.push({ text: text.slice(currentStart), isOperator: false });
	}

	return segments;
}

function chainOperatorLengthAt(text: string, index: number): number {
	const pair = text.slice(index, index + 2);

	if (PAIR_CHAIN_OPERATORS.includes(pair)) {
		return pair.length;
	}

	return SINGLE_CHAIN_OPERATORS.includes(text[index]) ? 1 : 0;
}

function readLineStyled(summary: RowGroupSummary, row: RowSummary, budget: number, wordPart: string): StyledText {
	const normalized = shortenDisplayPath(toSingleLine(row.target), summary.cwd, summary.homeDirectory);
	const pathPart = fitPathTarget(normalized, budget) ?? ELLIPSIS;
	const rangeMatch = LINE_RANGE_PATTERN.exec(pathPart);
	const rangeSuffix = rangeMatch?.[0] ?? BLANK;
	const pathWithoutRange = rangeSuffix ? pathPart.slice(0, -rangeSuffix.length) : pathPart;
	const lastSlash = pathWithoutRange.lastIndexOf(PATH_SEPARATOR);
	const spans: RowSpan[] = [];

	if (lastSlash >= 0) {
		spans.push({ text: pathWithoutRange.slice(0, lastSlash + 1), tone: "dim" });
		spans.push({ text: pathWithoutRange.slice(lastSlash + 1), tone: "text" });
	} else {
		spans.push({ text: pathWithoutRange, tone: "text" });
	}

	if (rangeSuffix) {
		spans.push({ text: rangeSuffix, tone: "accent" });
	}

	if (wordPart) {
		spans.push({ text: wordPart, tone: wordTone(row.status) });
	}

	return {
		text: `${pathPart}${wordPart}`,
		spans,
	};
}

function childColumnWidth(width: number): number {
	const percent = width > WIDE_WIDTH_THRESHOLD ? WIDE_COLUMN_PERCENT : COMMAND_COLUMN_PERCENT;
	const scaled = Math.floor((width * percent) / PERCENT);

	return Math.min(scaled, width);
}

function overflowLine(hiddenRows: readonly RowSummary[]): RowLine {
	const hiddenCount = hiddenRows.length;
	const prefix = `${OVERFLOW_MARK} (${hiddenCount} earlier ${pluralize(EARLIER_CALL_NOUN, hiddenCount)}`;
	const issues = summarizeIssues(hiddenRows);

	if (!issues) {
		const text = `${prefix})`;

		return {
			indent: MIDDLE_LINE_INDENT,
			mark: undefined,
			text,
			spans: [{ text, tone: "dim" }],
			duration: undefined,
			hint: undefined,
			isDim: true,
			memberIndex: DRAWING_MEMBER_INDEX,
		};
	}

	const text = `${prefix}${ISSUE_SEPARATOR}${issues.label})`;

	return {
		indent: MIDDLE_LINE_INDENT,
		mark: undefined,
		text,
		spans: [
			{ text: `${prefix}${ISSUE_SEPARATOR}`, tone: "dim" },
			{ text: issues.label, tone: issues.tone },
			{ text: ")", tone: "dim" },
		],
		duration: undefined,
		hint: undefined,
		isDim: true,
		memberIndex: DRAWING_MEMBER_INDEX,
	};
}

function toSingleLine(text: string): string {
	return text.replace(WHITESPACE_PATTERN, SPACE).trim();
}
