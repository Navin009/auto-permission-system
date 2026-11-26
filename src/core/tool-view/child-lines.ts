import { appendSummaryTailSpans, subGroupTargetText } from "./header-lines.ts";
import { RowKind, rowLabelOf } from "./row-kind.ts";
import {
	activeIssueSummary,
	BLANK,
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
	splitSubGroups,
	summarizeIssues,
	toSingleLine,
	wordText,
	wordTone,
	type RowGroupSummary,
	type RowLine,
	type RowSpan,
	type RowSummary,
	type StyledText,
	type SubGroup,
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

interface SubGroupLineInput {
	summary: RowGroupSummary;
	subGroup: SubGroup;
	status: ToolStatus;
	isLastSubGroup: boolean;
	isActive: boolean;
	width: number;
}

const NEWEST_ROW_LIMIT = 8;
const EARLIER_CALL_NOUN = "call";
const EARLIER_GROUP_NOUN = "group";
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

	appendGroupRows({
		lines,
		summary,
		rows: summary.rows,
		startMemberIndex: 0,
		branchPrefix: BLANK,
		childColumn: childColumnWidth(width),
		width,
	});

	return lines;
}

function buildMixedChildLines(summary: RowGroupSummary, width: number): RowLine[] {
	const allSubGroups = splitSubGroups(summary);
	const visibleSubGroups = newestItems(allSubGroups);
	const hiddenSubGroups = allSubGroups.slice(0, allSubGroups.length - visibleSubGroups.length);
	const lines: RowLine[] =
		hiddenSubGroups.length > 0
			? [
					overflowLine(
						hiddenSubGroups.flatMap((group) => group.rows),
						EARLIER_GROUP_NOUN,
						hiddenSubGroups.length,
					),
				]
			: [];
	const childColumn = childColumnWidth(width);

	visibleSubGroups.forEach((subGroup, subIndex) => {
		const isLastSubGroup = subIndex === visibleSubGroups.length - 1;
		const subStatus = subGroupStatus(subGroup);
		const isActive = subStatus === ToolStatus.Running;

		lines.push(subGroupSummaryLine({ summary, subGroup, status: subStatus, isLastSubGroup, isActive, width }));

		if (!isActive) {
			return;
		}

		appendGroupRows({
			lines,
			summary,
			rows: subGroup.rows,
			startMemberIndex: subGroup.startMemberIndex,
			branchPrefix: isLastSubGroup ? LAST_ROW_SPACER : MIDDLE_ROW_SPACER,
			childColumn,
			width,
		});
	});

	return lines;
}

function appendGroupRows(input: {
	lines: RowLine[];
	summary: RowGroupSummary;
	rows: readonly RowSummary[];
	startMemberIndex: number;
	branchPrefix: string;
	childColumn: number;
	width: number;
}): void {
	const { lines, summary, rows, startMemberIndex, branchPrefix, childColumn, width } = input;
	const isSingle = rows.length === SINGLE_ROW_COUNT;
	const visibleRows = newestItems(rows);
	const hiddenCount = rows.length - visibleRows.length;
	const hiddenRows = rows.slice(0, hiddenCount);

	if (hiddenRows.length > 0) {
		lines.push(overflowLine(hiddenRows, EARLIER_CALL_NOUN, hiddenRows.length, branchPrefix));
	}

	visibleRows.forEach((row, offset) => {
		const placement: ChildLinePlacement = {
			isSingle,
			isLastLine: offset === visibleRows.length - 1,
			childColumn,
			memberIndex: startMemberIndex + hiddenCount + offset,
			segmentIndex: row.segmentIndex,
			branchPrefix,
		};

		for (const line of memberChildLines(summary, row, placement, width)) {
			lines.push(line);
		}
	});
}

function newestItems<T>(items: readonly T[]): readonly T[] {
	if (items.length <= NEWEST_ROW_LIMIT) {
		return items;
	}

	return items.slice(items.length - NEWEST_ROW_LIMIT);
}

function subGroupStatus(subGroup: SubGroup): ToolStatus {
	if (subGroup.rows.some((row) => row.status === ToolStatus.Running)) {
		return ToolStatus.Running;
	}

	return subGroup.rows.at(-1)?.status ?? ToolStatus.Ok;
}

function subGroupSummaryLine(input: SubGroupLineInput): RowLine {
	const { summary, subGroup, status, isLastSubGroup, isActive, width } = input;
	const indent = isLastSubGroup ? LAST_LINE_INDENT : MIDDLE_LINE_INDENT;
	const mark = { glyph: statusMark(status, summary.spinnerFrame), status };
	const titlePart = subGroupTitle(subGroup);
	const issues = activeIssueSummary(subGroup.rows, status);
	const issuePart = issues ? `${SPACE}(${issues.label})` : BLANK;
	const wordPart = wordText(status, !isActive || subGroup.rows.length === SINGLE_ROW_COUNT);
	const noticePart = !isActive && hasAnyNote(subGroup.rows) ? `${SPACE}${FOLDED_NOTE_BADGE}` : BLANK;
	const fixedWidth =
		indent.length + markColumnWidth(mark) + titlePart.length + issuePart.length + wordPart.length + noticePart.length;
	const subSummary: RowGroupSummary = {
		kind: subGroup.kind,
		rows: subGroup.rows,
		durationMilliseconds: undefined,
		folded: true,
		hint: undefined,
		thinking: undefined,
		spinnerFrame: summary.spinnerFrame,
		cwd: summary.cwd,
		homeDirectory: summary.homeDirectory,
	};
	const targetPart = isActive ? BLANK : subGroupTargetText(subSummary, width - fixedWidth);
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
		memberIndex: subGroup.startMemberIndex,
		segmentIndex: subGroup.rows[0]?.segmentIndex ?? DRAWING_MEMBER_INDEX,
	};
}

function subGroupTitle(subGroup: SubGroup): string {
	const label = rowLabelOf(subGroup.kind);
	const count = subGroup.rows.length;

	if (label.fixedTitle) {
		return label.fixedTitle;
	}

	return `${label.verb} ${count} ${pluralize(label.noun, count)}`;
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
	subLines: readonly SubLineSummary[],
	placement: ChildLinePlacement,
	spinnerFrame: number | undefined,
): RowLine[] {
	return subLines.map((subLine, index) =>
		subLineLine(
			subLine,
			{ ...placement, isLastLine: placement.isLastLine && index === subLines.length - 1 },
			spinnerFrame,
		),
	);
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
): RowLine {
	const indent = rowLineIndent(placement);
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
	if (rowEffectiveKind(summary, row) === RowKind.Shell) {
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
