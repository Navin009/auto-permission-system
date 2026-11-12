import { formatCommandDuration } from "./duration.ts";
import { RowKind, rowLabelOf } from "./row-kind.ts";
import { statusMark, statusWord, ToolStatus } from "./status.ts";
import { displayShellCommand, fitCommand, fitTarget, summarizeShellCommand } from "./target-summary.ts";
import { wrapText } from "./text-wrap.ts";
import { thinkingPart, type ThinkingState } from "./thinking.ts";

export interface RowSummary {
	target: string;
	status: ToolStatus;
	durationMilliseconds: number | undefined;
}

export interface ThoughtSummary {
	text: string;
	elapsedMilliseconds: number | undefined;
	isExpanded: boolean;
}

export type RowChild =
	| { type: "command"; row: RowSummary }
	| { type: "thought"; thought: ThoughtSummary };

export interface RowGroupSummary {
	kind: RowKind;
	children: readonly RowChild[];
	durationMilliseconds: number | undefined;
	folded: boolean;
	hint: string | undefined;
	thinking: ThinkingState | undefined;
	isNewestGroup: boolean;
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
	isItalic: boolean;
	thoughtIndex: number | undefined;
}

export function markColumnWidth(mark: RowMark | undefined): number {
	return mark ? MARK_COLUMN_WIDTH : 0;
}

const COMMAND_CHILD = "command";
const NEWEST_ROW_LIMIT = 8;
const SINGLE_ROW_COUNT = 1;
const EARLIER_CALL_NOUN = "call";
const LINE_INDENT = "  └ ";
const LIVE_THOUGHT_BODY_INDENT = "  ";
const SETTLED_THOUGHT_BODY_INDENT = "    ";
const SHELL_PROMPT = "$";
const RUNNING_LINE_MARK = "…";
const OVERFLOW_MARK = "...";
const LIVE_THOUGHT_TEXT = "Thinking...";
const SETTLED_THOUGHT_TEXT = "~ thinking";
const THOUGHT_LINE_LIMIT = 12;
const TRUNCATION_MARK = "…";
const SPACE = " ";
const HEADER_DURATION_SEPARATOR = "· ";
const PLURAL_ENDING = "s";
const PLURAL_Y_ENDING = "ies";
const WHITESPACE_PATTERN = /\s+/g;
const BLANK = "";
const MARK_COLUMN_WIDTH = 2;
const TARGET_PARENTHESES_WIDTH = 3;
const MINIMUM_TARGET_WIDTH = 12;
const MINIMUM_THOUGHT_WIDTH = 16;
const COMMAND_COLUMN_PERCENT = 70;
const PERCENT = 100;

export function rowGroupLines(summary: RowGroupSummary, width: number): RowLine[] {
	const showsCommandLines = rowLabelOf(summary.kind).showsChildLines;
	const foldedHint = summary.folded || !showsCommandLines;
	const status = headerStatus(summary);
	const header = headerLine(summary, status, foldedHint, width);
	const children = summary.folded
		? bottomThoughtLines(summary, width)
		: childLines(summary, width, showsCommandLines);

	return [header, ...children];
}

export function pluralize(noun: string, count: number): string {
	if (count === SINGLE_ROW_COUNT) {
		return noun;
	}

	return noun.endsWith("y") ? `${noun.slice(0, -1)}${PLURAL_Y_ENDING}` : `${noun}${PLURAL_ENDING}`;
}

function headerStatus(summary: RowGroupSummary): ToolStatus {
	const lastStatus = commandRows(summary).at(-1)?.status ?? ToolStatus.Running;

	if (summary.thinking && lastStatus === ToolStatus.Ok) {
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
	const duration = headerDuration(summary.durationMilliseconds);
	const tail = tailWidth(hint, duration);

	return {
		indent: BLANK,
		mark: { glyph: statusMark(status), status },
		text: headerText(summary, status, folded, width - tail),
		duration,
		hint,
		isDim: false,
		isItalic: false,
		thoughtIndex: undefined,
	};
}

function headerText(
	summary: RowGroupSummary,
	status: ToolStatus,
	folded: boolean,
	width: number,
): string {
	const countPart = countText(summary);
	const thoughtPart = summary.thinking ? `${SPACE}${thinkingPart(summary.thinking)}` : "";
	const wordPart = wordText(status, folded || commandRows(summary).length === SINGLE_ROW_COUNT);
	const fixedWidth = MARK_COLUMN_WIDTH + countPart.length + thoughtPart.length + wordPart.length;
	const targetPart = targetText(summary, folded, width - fixedWidth);

	return `${countPart}${targetPart}${thoughtPart}${wordPart}`;
}

function countText(summary: RowGroupSummary): string {
	const label = rowLabelOf(summary.kind);
	const count = commandRows(summary).length;

	return `${label.verb} ${count} ${pluralize(label.noun, count)}`;
}

function targetText(summary: RowGroupSummary, folded: boolean, availableWidth: number): string {
	const target = folded ? commandRows(summary).at(-1)?.target : undefined;
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

function childLines(summary: RowGroupSummary, width: number, showsCommandLines: boolean): RowLine[] {
	const isSingle = commandRows(summary).length === SINGLE_ROW_COUNT;
	const commandColumn = commandColumnWidth(width);
	const visibleChildren = newestChildren(summary.children, showsCommandLines);
	const hiddenCount = hiddenCommandCount(summary.children, visibleChildren);
	const lines = hiddenCount > 0 ? [overflowLine(hiddenCount)] : [];
	let thoughtIndex = thoughtCountBefore(summary.children, visibleChildren);

	const bottom = bottomThoughtOf(summary);

	for (const child of visibleChildren) {
		if (child.type === "thought") {
			const isBottom = bottom?.index === thoughtIndex;

			lines.push(...thoughtLines(child.thought, thoughtIndex, isBottom, width));
			thoughtIndex += 1;
			continue;
		}

		if (showsCommandLines) {
			lines.push(commandLine(child.row, isSingle, commandColumn));
		}
	}

	return lines;
}

function bottomThoughtLines(summary: RowGroupSummary, width: number): RowLine[] {
	const bottom = bottomThoughtOf(summary);

	return bottom ? thoughtLines(bottom.thought, bottom.index, true, width) : [];
}

interface ThoughtAt {
	thought: ThoughtSummary;
	index: number;
}

function bottomThoughtOf(summary: RowGroupSummary): ThoughtAt | undefined {
	if (!summary.isNewestGroup) {
		return undefined;
	}

	const lastChild = summary.children.at(-1);

	if (!lastChild || lastChild.type !== "thought") {
		return undefined;
	}

	const index = summary.children.filter((child) => child.type === "thought").length - 1;

	return { thought: lastChild.thought, index };
}

function thoughtCountBefore(children: readonly RowChild[], visibleChildren: readonly RowChild[]): number {
	const firstVisible = visibleChildren.at(0);

	if (!firstVisible) {
		return 0;
	}

	const visibleFrom = children.indexOf(firstVisible);

	return children.slice(0, visibleFrom).filter((child) => child.type === "thought").length;
}

function newestChildren(children: readonly RowChild[], showsCommandLines: boolean): readonly RowChild[] {
	if (!showsCommandLines) {
		return children;
	}

	const commandCount = children.filter((child) => child.type === COMMAND_CHILD).length;
	const hideCount = Math.max(0, commandCount - NEWEST_ROW_LIMIT);

	if (hideCount === 0) {
		return children;
	}

	let hiddenCommands = 0;
	let visibleFrom = 0;

	for (const [index, child] of children.entries()) {
		if (child.type === COMMAND_CHILD) {
			hiddenCommands += 1;
		}

		if (hiddenCommands === hideCount) {
			visibleFrom = index + 1;
			break;
		}
	}

	return children.slice(visibleFrom);
}

function hiddenCommandCount(children: readonly RowChild[], visibleChildren: readonly RowChild[]): number {
	const commands = children.filter((child) => child.type === COMMAND_CHILD).length;
	const visibleCommands = visibleChildren.filter((child) => child.type === COMMAND_CHILD).length;

	return Math.max(0, commands - visibleCommands);
}

function thoughtLines(thought: ThoughtSummary, index: number, isBottom: boolean, width: number): RowLine[] {
	const head = isBottom ? liveThoughtLine(index) : settledThoughtLine(thought, index);

	if (!thought.isExpanded) {
		return [head];
	}

	return [head, ...thoughtBodyLines(thought, index, width, isBottom)];
}

function liveThoughtLine(index: number): RowLine {
	return {
		indent: BLANK,
		mark: undefined,
		text: LIVE_THOUGHT_TEXT,
		duration: undefined,
		hint: undefined,
		isDim: true,
		isItalic: true,
		thoughtIndex: index,
	};
}

function settledThoughtLine(thought: ThoughtSummary, index: number): RowLine {
	const elapsed = formatCommandDuration(thought.elapsedMilliseconds ?? 0);

	return {
		indent: LINE_INDENT,
		mark: undefined,
		text: `${SETTLED_THOUGHT_TEXT}${SPACE}${elapsed}`,
		duration: undefined,
		hint: undefined,
		isDim: true,
		isItalic: true,
		thoughtIndex: index,
	};
}

function thoughtBodyLines(thought: ThoughtSummary, index: number, width: number, isBottom: boolean): RowLine[] {
	const indent = isBottom ? LIVE_THOUGHT_BODY_INDENT : SETTLED_THOUGHT_BODY_INDENT;
	const budget = Math.max(MINIMUM_THOUGHT_WIDTH, width - indent.length);
	const wrapped = wrapText(thought.text, budget);
	const shown = wrapped.length > THOUGHT_LINE_LIMIT
		? [...wrapped.slice(0, THOUGHT_LINE_LIMIT - 1), TRUNCATION_MARK]
		: wrapped;

	return shown.map((chunk) => ({
		indent,
		mark: undefined,
		text: chunk,
		duration: undefined,
		hint: undefined,
		isDim: true,
		isItalic: true,
		thoughtIndex: index,
	}));
}

function commandLine(row: RowSummary, isSingle: boolean, commandColumn: number): RowLine {
	const mark = isSingle ? undefined : { glyph: childMark(row.status), status: row.status };
	const wordPart = isSingle ? BLANK : wordText(row.status, true);
	const budget = commandColumn - LINE_INDENT.length - markColumnWidth(mark) - wordPart.length;

	return {
		indent: LINE_INDENT,
		mark,
		text: commandLineText(row, budget, wordPart),
		duration: commandDuration(row, isSingle),
		hint: undefined,
		isDim: true,
		isItalic: false,
		thoughtIndex: undefined,
	};
}

function childMark(status: ToolStatus): string {
	return status === ToolStatus.Running ? RUNNING_LINE_MARK : statusMark(status);
}

function commandLineText(row: RowSummary, budget: number, wordPart: string): string {
	const promptPart = `${SHELL_PROMPT}${SPACE}`;
	const commandPart = fitCommand(displayShellCommand(row.target), budget - promptPart.length);

	return `${promptPart}${commandPart}${wordPart}`;
}

function commandDuration(row: RowSummary, isSingle: boolean): string | undefined {
	if (isSingle || row.status === ToolStatus.Running || row.durationMilliseconds === undefined) {
		return undefined;
	}

	return formatCommandDuration(row.durationMilliseconds);
}

function commandRows(summary: RowGroupSummary): RowSummary[] {
	return summary.children.flatMap((child) => (child.type === COMMAND_CHILD ? [child.row] : []));
}

function commandColumnWidth(width: number): number {
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
		isItalic: false,
		thoughtIndex: undefined,
	};
}

function toSingleLine(text: string): string {
	return text.replace(WHITESPACE_PATTERN, SPACE).trim();
}
