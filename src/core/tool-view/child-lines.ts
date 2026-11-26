import { appendSummaryTailSpans, fitCommaList, fittedNamesList } from "./header-lines.ts";
import { RowKind } from "./row-kind.ts";
import {
	activeIssueSummary,
	BLANK,
	codemodeCallEntries,
	DRAWING_MEMBER_INDEX,
	ELLIPSIS,
	FOLDED_NOTE_BADGE,
	hasAnyNote,
	HINT_SEPARATOR,
	isMixedBatch,
	markColumnWidth,
	PATH_SEPARATOR,
	pluralize,
	rowEffectiveKind,
	SINGLE_ROW_COUNT,
	SPACE,
	summarizeIssues,
	toSingleLine,
	wordText,
	wordTone,
	type RowGroupSummary,
	type RowLine,
	type RowSpan,
	type RowSummary,
	type StyledText,
	type SubLineSummary,
} from "./row-group-types.ts";
import { splitShellOperatorSegments } from "./shell-segments.ts";
import { statusMark, ToolStatus } from "./status.ts";
import { displayShellCommand, fitCommand, fitPathTarget, fitTarget, shortenDisplayPath } from "./target-summary.ts";

interface ChildLinePlacement {
	isSingle: boolean;
	isLastLine: boolean;
	childColumn: number;
	memberIndex: number;
	segmentIndex: number;
	branchPrefix: string;
}

interface ChainStage {
	operator: string | undefined;
	command: string;
}

interface ChildCommandLineInput {
	summary: RowGroupSummary;
	row: RowSummary;
	placement: ChildLinePlacement;
	commandText: string;
	asProgramLine: boolean;
}

type MixedEntry =
	| { kind: "command"; row: RowSummary; memberIndex: number }
	| { kind: "read-run"; rows: readonly RowSummary[]; startMemberIndex: number };

const NEWEST_ROW_LIMIT = 8;
const CODEMODE_ROW_LIMIT = 12;
const SUB_LINE_LIMIT = 12;
const EARLIER_CALL_NOUN = "call";
const EARLIER_ACTION_NOUN = "action";
const EARLIER_INNER_CALL_NOUN = "inner call";
const READ_PREFIX = "read ";
const READ_FILE_NOUN = "file";
const READ_BATCH_NAME_LIMITS: readonly number[] = [3, 2, 1];
const CODEMODE_TOOL_LIMITS: readonly number[] = [3, 2, 1];
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
const SHELL_PROMPT = "$";
const OVERFLOW_MARK = "...";
const ISSUE_SEPARATOR = " · ";
const LINE_BREAK_PATTERN = /\r?\n/;
const WHITESPACE_PATTERN = /\s+/g;
const MAX_RUNNING_SUB_LINES = 3;
const LINE_NOUN = "line";
const LINE_RANGE_PATTERN = /:\d+(?:-\d+)?$/;
const COMMAND_COLUMN_PERCENT = 70;
const WIDE_COLUMN_PERCENT = 85;
const WIDE_WIDTH_THRESHOLD = 100;
const PERCENT = 100;

export function buildChildLines(summary: RowGroupSummary, width: number, showsChildLines: boolean): RowLine[] {
	if (!showsChildLines) {
		return [];
	}

	if (isMixedBatch(summary)) {
		return buildMixedChildLines(summary, width);
	}

	const lines: RowLine[] = [];

	const limit = summary.kind === RowKind.Codemode ? CODEMODE_ROW_LIMIT : NEWEST_ROW_LIMIT;

	appendGroupRows({
		lines,
		summary,
		rows: summary.rows,
		startMemberIndex: 0,
		branchPrefix: BLANK,
		childColumn: childColumnWidth(width),
		width,
		limit,
	});

	return lines;
}

function buildMixedChildLines(summary: RowGroupSummary, width: number): RowLine[] {
	const entries = buildMixedEntries(summary);
	const visibleEntries = newestItems(entries);
	const hiddenEntries = entries.slice(0, entries.length - visibleEntries.length);
	const hiddenRows = hiddenEntries.flatMap((entry) => (entry.kind === "command" ? [entry.row] : entry.rows));
	const lines: RowLine[] =
		hiddenRows.length > 0 ? [overflowLine(hiddenRows, EARLIER_ACTION_NOUN, hiddenRows.length)] : [];
	const childColumn = childColumnWidth(width);

	visibleEntries.forEach((entry, index) => {
		const isLastLine = index === visibleEntries.length - 1;

		if (entry.kind === "command") {
			const placement: ChildLinePlacement = {
				isSingle: false,
				isLastLine,
				childColumn,
				memberIndex: entry.memberIndex,
				segmentIndex: entry.row.segmentIndex,
				branchPrefix: BLANK,
			};

			for (const line of memberChildLines({ summary, row: entry.row, placement, width, expandSubLines: true })) {
				lines.push(line);
			}

			return;
		}

		for (const line of readRunLines(summary, entry, { isLastLine, childColumn, width })) {
			lines.push(line);
		}
	});

	return lines;
}

function buildMixedEntries(summary: RowGroupSummary): MixedEntry[] {
	const entries: MixedEntry[] = [];

	summary.rows.forEach((row, index) => {
		if (rowEffectiveKind(summary, row) === RowKind.Shell) {
			entries.push({ kind: "command", row, memberIndex: index });
			return;
		}

		const previous = entries.at(-1);

		if (previous && previous.kind === "read-run") {
			(previous.rows as RowSummary[]).push(row);
			return;
		}

		entries.push({ kind: "read-run", rows: [row], startMemberIndex: index });
	});

	return entries;
}

function readRunLines(
	summary: RowGroupSummary,
	entry: Extract<MixedEntry, { kind: "read-run" }>,
	layout: { isLastLine: boolean; childColumn: number; width: number },
): RowLine[] {
	if (entry.rows.length === SINGLE_ROW_COUNT) {
		const row = entry.rows[0];
		const placement: ChildLinePlacement = {
			isSingle: false,
			isLastLine: layout.isLastLine,
			childColumn: layout.childColumn,
			memberIndex: entry.startMemberIndex,
			segmentIndex: row.segmentIndex,
			branchPrefix: BLANK,
		};

		return [singleMixedReadLine(summary, row, placement), ...noteLines(row, placement, layout.width)];
	}

	return [multiMixedReadLine(summary, entry, layout)];
}

function singleMixedReadLine(summary: RowGroupSummary, row: RowSummary, placement: ChildLinePlacement): RowLine {
	const indent = rowLineIndent(placement);
	const mark = { glyph: statusMark(row.status, summary.spinnerFrame), status: row.status };
	const wordPart = wordText(row.status, true);
	const budget = placement.childColumn - indent.length - markColumnWidth(mark) - READ_PREFIX.length - wordPart.length;
	const styledPath = readLineStyled(summary, row, Math.max(1, budget), wordPart);
	const spans: RowSpan[] = [{ text: READ_PREFIX, tone: "dim" }, ...styledPath.spans];

	return {
		indent,
		mark,
		text: `${READ_PREFIX}${styledPath.text}`,
		spans,
		duration: undefined,
		hint: undefined,
		isDim: true,
		memberIndex: placement.memberIndex,
		segmentIndex: placement.segmentIndex,
	};
}

function multiMixedReadLine(
	summary: RowGroupSummary,
	entry: Extract<MixedEntry, { kind: "read-run" }>,
	layout: { isLastLine: boolean; childColumn: number; width: number },
): RowLine {
	const indent = layout.isLastLine ? LAST_LINE_INDENT : MIDDLE_LINE_INDENT;
	const status = readRunStatus(entry.rows);
	const mark = { glyph: statusMark(status, summary.spinnerFrame), status };
	const titlePart = `${READ_PREFIX}${entry.rows.length} ${pluralize(READ_FILE_NOUN, entry.rows.length)}`;
	const issues = activeIssueSummary(entry.rows, status);
	const issuePart = issues ? `${SPACE}(${issues.label})` : BLANK;
	const wordPart = wordText(status, true);
	const noticePart = hasAnyNote(entry.rows) ? `${SPACE}${FOLDED_NOTE_BADGE}` : BLANK;
	const fixedWidth =
		indent.length + markColumnWidth(mark) + titlePart.length + issuePart.length + wordPart.length + noticePart.length;
	const names = entry.rows.map((row) => shortReadFileName(summary, row.target));
	const targetPart = fittedNamesList(names, layout.width - fixedWidth, READ_BATCH_NAME_LIMITS);
	const spans: RowSpan[] = [{ text: titlePart, tone: "title" }];

	appendSummaryTailSpans(spans, { issues, issuePart, targetPart, wordPart, status, noticePart });

	return {
		indent,
		mark,
		text: `${titlePart}${issuePart}${targetPart}${wordPart}${noticePart}`,
		spans,
		duration: undefined,
		hint: undefined,
		isDim: false,
		memberIndex: entry.startMemberIndex,
		segmentIndex: entry.rows[0]?.segmentIndex ?? DRAWING_MEMBER_INDEX,
	};
}

function readRunStatus(rows: readonly RowSummary[]): ToolStatus {
	if (rows.some((row) => row.status === ToolStatus.Running)) {
		return ToolStatus.Running;
	}

	return rows.at(-1)?.status ?? ToolStatus.Ok;
}

function shortReadFileName(summary: RowGroupSummary, target: string): string {
	const shortened = shortenDisplayPath(toSingleLine(target), summary.cwd, summary.homeDirectory);
	const lastSlash = shortened.lastIndexOf(PATH_SEPARATOR);

	return lastSlash >= 0 ? shortened.slice(lastSlash + 1) : shortened;
}

function appendGroupRows(input: {
	lines: RowLine[];
	summary: RowGroupSummary;
	rows: readonly RowSummary[];
	startMemberIndex: number;
	branchPrefix: string;
	childColumn: number;
	width: number;
	limit?: number;
}): void {
	const { lines, summary, rows, startMemberIndex, branchPrefix, childColumn, width, limit } = input;
	const isSingle = rows.length === SINGLE_ROW_COUNT;
	const visibleRows = newestItems(rows, limit);
	const hiddenCount = rows.length - visibleRows.length;
	const hiddenRows = rows.slice(0, hiddenCount);

	if (hiddenRows.length > 0) {
		lines.push(overflowLine(hiddenRows, EARLIER_CALL_NOUN, hiddenRows.length, branchPrefix));
	}

	visibleRows.forEach((row, offset) => {
		const isLastRow = offset === visibleRows.length - 1;
		const placement: ChildLinePlacement = {
			isSingle,
			isLastLine: isLastRow,
			childColumn,
			memberIndex: startMemberIndex + hiddenCount + offset,
			segmentIndex: row.segmentIndex,
			branchPrefix,
		};
		const expandSubLines = shouldExpandRowSubLines(summary, row);

		for (const line of memberChildLines({ summary, row, placement, width, expandSubLines })) {
			lines.push(line);
		}
	});
}

function shouldExpandRowSubLines(summary: RowGroupSummary, row: RowSummary): boolean {
	if (!row.subLines) {
		return false;
	}

	if (rowEffectiveKind(summary, row) !== RowKind.Codemode) {
		return true;
	}

	return row.status === ToolStatus.Running && codemodeCallEntries(row.subLines).length > 0;
}

function newestItems<T>(items: readonly T[], limit = NEWEST_ROW_LIMIT): readonly T[] {
	if (items.length <= limit) {
		return items;
	}

	return items.slice(items.length - limit);
}

function memberChildLines(input: {
	summary: RowGroupSummary;
	row: RowSummary;
	placement: ChildLinePlacement;
	width: number;
	expandSubLines: boolean;
}): RowLine[] {
	const { summary, row, placement, width, expandSubLines } = input;
	const subLines = expandSubLines ? row.subLines : undefined;
	const rowLines = subLines
		? buildSubLines(summary, row, subLines, placement)
		: buildMemberRowLines(summary, row, placement);

	return [...rowLines, ...noteLines(row, placement, width)];
}

function buildMemberRowLines(summary: RowGroupSummary, row: RowSummary, placement: ChildLinePlacement): RowLine[] {
	if (rowEffectiveKind(summary, row) === RowKind.Shell && row.status === ToolStatus.Running) {
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

	const middleStages = stages.slice(1, stages.length - 1);
	const lastStage = stages.at(-1);

	if (!lastStage) {
		return [firstLine];
	}

	return [
		firstLine,
		chainMiddleStagesSubLine(middleStages, placement),
		chainStageSubLine(lastStage, placement, SUB_BRANCH_LAST),
	];
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

function chainMiddleStagesSubLine(middleStages: readonly ChainStage[], placement: ChildLinePlacement): RowLine {
	const indent = subBranchIndent(placement, SUB_BRANCH_MIDDLE);
	const leadingOperator = middleStages[0]?.operator;
	const operatorPrefix = leadingOperator ? `${leadingOperator}${SPACE}` : BLANK;
	const combinedCommand = middleStages
		.map((stage, index) => (index > 0 && stage.operator ? `${stage.operator}${SPACE}${stage.command}` : stage.command))
		.join(SPACE);
	const budget = Math.max(1, placement.childColumn - indent.length - operatorPrefix.length);
	const fitted = fitCommand(combinedCommand, budget);
	const spans: RowSpan[] = [];

	if (operatorPrefix) {
		spans.push({ text: operatorPrefix, tone: "dim" });
	}

	const truncatedPrefix = `${ELLIPSIS}${SPACE}`;

	if (fitted.startsWith(truncatedPrefix)) {
		spans.push({ text: truncatedPrefix, tone: "dim" });
		appendShellCommandSpans(spans, fitted.slice(truncatedPrefix.length), false);
	} else {
		appendShellCommandSpans(spans, fitted, true);
	}

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

function subBranchIndent(placement: ChildLinePlacement, connector: string): string {
	const rowSpacer = placement.isLastLine ? LAST_ROW_SPACER : MIDDLE_ROW_SPACER;
	const markSpacer = placement.isSingle ? BLANK : MARK_SPACER;

	return `${placement.branchPrefix}${rowSpacer}${markSpacer}${connector}`;
}

function rowLineIndent(placement: ChildLinePlacement): string {
	return `${placement.branchPrefix}${placement.isLastLine ? LAST_LINE_INDENT : MIDDLE_LINE_INDENT}`;
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

function childLineWithCommand(input: ChildCommandLineInput): RowLine {
	const { summary, row, placement, commandText, asProgramLine } = input;
	const indent = rowLineIndent(placement);
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
	summary: RowGroupSummary,
	row: RowSummary,
	subLines: readonly SubLineSummary[],
	placement: ChildLinePlacement,
): RowLine[] {
	const parentLine = childLine(summary, row, placement);
	const callEntries = codemodeCallEntries(subLines);

	if (callEntries.length === 0) {
		return [parentLine];
	}

	const visibleCalls = newestItems(callEntries, SUB_LINE_LIMIT);
	const hiddenCount = callEntries.length - visibleCalls.length;
	const lines: RowLine[] = [parentLine];

	if (hiddenCount > 0) {
		lines.push(subLineOverflowLine(hiddenCount, placement));
	}

	visibleCalls.forEach((subLine, index) => {
		const connector = index === visibleCalls.length - 1 ? SUB_BRANCH_LAST : SUB_BRANCH_MIDDLE;

		lines.push(subLineLine(subLine, placement, summary.spinnerFrame, connector));
	});

	return lines;
}

function subLineOverflowLine(hiddenCount: number, placement: ChildLinePlacement): RowLine {
	const text = `${OVERFLOW_MARK} (${hiddenCount} earlier ${pluralize(EARLIER_INNER_CALL_NOUN, hiddenCount)})`;

	return {
		indent: subBranchIndent(placement, SUB_BRANCH_MIDDLE),
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

	const firstIndent = `${placement.branchPrefix}${placement.isLastLine ? LAST_NOTE_FIRST_INDENT : MIDDLE_NOTE_FIRST_INDENT}`;
	const continuationIndent = `${placement.branchPrefix}${placement.isLastLine ? LAST_NOTE_CONTINUATION_INDENT : MIDDLE_NOTE_CONTINUATION_INDENT}`;
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
	connector: string,
): RowLine {
	const indent = subBranchIndent(placement, connector);
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
	const indent = rowLineIndent(placement);
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
	const kind = rowEffectiveKind(summary, row);

	if (kind === RowKind.Shell) {
		return shellLineStyled(row.target, budget, wordPart, row.status);
	}

	if (kind === RowKind.Codemode) {
		return codemodeLineStyled(row, budget, wordPart);
	}

	return readLineStyled(summary, row, budget, wordPart);
}

function codemodeLineStyled(row: RowSummary, budget: number, wordPart: string): StyledText {
	const callEntries = codemodeCallEntries(row.subLines);

	if (callEntries.length === 0) {
		const fitted = fitTarget(toSingleLine(row.target), budget) ?? ELLIPSIS;
		const spans: RowSpan[] = [{ text: fitted, tone: "dim", italic: true }];

		if (wordPart) {
			spans.push({ text: wordPart, tone: wordTone(row.status) });
		}

		return {
			text: `${fitted}${wordPart}`,
			spans,
		};
	}

	const uniqueTools = uniqueCodemodeTools(callEntries);
	const countSuffix = `${SPACE}(${callEntries.length} ${pluralize(EARLIER_CALL_NOUN, callEntries.length)})`;
	const toolsBudget = Math.max(1, budget - countSuffix.length);
	const fittedTools =
		fitCommaList(uniqueTools, toolsBudget, CODEMODE_TOOL_LIMITS) ?? fitPlainLine(uniqueTools[0], toolsBudget);
	const spans: RowSpan[] = [
		{ text: fittedTools, tone: "text" },
		{ text: countSuffix, tone: "muted" },
	];

	if (wordPart) {
		spans.push({ text: wordPart, tone: wordTone(row.status) });
	}

	return {
		text: `${fittedTools}${countSuffix}${wordPart}`,
		spans,
	};
}

function uniqueCodemodeTools(callEntries: readonly SubLineSummary[]): string[] {
	const seen = new Set<string>();

	for (const entry of callEntries) {
		const name = codemodeEntryToolName(entry);

		if (name) {
			seen.add(name);
		}
	}

	return [...seen];
}

function codemodeEntryToolName(entry: SubLineSummary): string {
	if (entry.toolName) {
		return entry.toolName;
	}

	if (entry.detail && entry.text.endsWith(`${SPACE}${entry.detail}`)) {
		return entry.text.slice(0, -(entry.detail.length + SPACE.length));
	}

	const firstSpace = entry.text.indexOf(SPACE);

	return firstSpace > 0 ? entry.text.slice(0, firstSpace) : entry.text;
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

function overflowLine(
	hiddenRows: readonly RowSummary[],
	noun: string,
	hiddenCount = hiddenRows.length,
	branchPrefix = BLANK,
): RowLine {
	const indent = `${branchPrefix}${MIDDLE_LINE_INDENT}`;
	const prefix = `${OVERFLOW_MARK} (${hiddenCount} earlier ${pluralize(noun, hiddenCount)}`;
	const issues = summarizeIssues(hiddenRows);

	if (!issues) {
		const text = `${prefix})`;

		return {
			indent,
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
		indent,
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
