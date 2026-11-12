import { formatCommandDuration } from "./duration.ts";
import { statusMark, statusWord, ToolStatus } from "./status.ts";

export interface CommandSummary {
	command: string;
	status: ToolStatus;
	durationMilliseconds: number | undefined;
}

export interface CommandGroupSummary {
	commands: readonly CommandSummary[];
	durationMilliseconds: number | undefined;
	folded: boolean;
	hint: string | undefined;
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

const NEWEST_COMMAND_LIMIT = 8;
const SINGLE_COMMAND_COUNT = 1;
const COUNT_PREFIX = "Running";
const COMMAND_NOUN = "command";
const EARLIER_CALL_NOUN = "call";
const LINE_INDENT = "  └ ";
const COMMAND_PROMPT = "$";
const RUNNING_LINE_MARK = "…";
const OVERFLOW_MARK = "...";
const SPACE = " ";
const DURATION_SEPARATOR = " · ";
const PLURAL_ENDING = "s";
const PLURAL_Y_ENDING = "ies";
const WHITESPACE_PATTERN = /\s+/g;

export function commandGroupLines(summary: CommandGroupSummary): RowLine[] {
	const status = lastStatus(summary.commands);
	const lines = [headerLine(summary, status)];

	if (summary.folded) {
		return lines;
	}

	return [...lines, ...commandLines(summary.commands)];
}

export function pluralize(noun: string, count: number): string {
	if (count === SINGLE_COMMAND_COUNT) {
		return noun;
	}

	return noun.endsWith("y") ? `${noun.slice(0, -1)}${PLURAL_Y_ENDING}` : `${noun}${PLURAL_ENDING}`;
}

function lastStatus(commands: readonly CommandSummary[]): ToolStatus {
	return commands.at(-1)?.status ?? ToolStatus.Running;
}

function headerLine(summary: CommandGroupSummary, status: ToolStatus): RowLine {
	return {
		indent: "",
		mark: { glyph: statusMark(status), status },
		text: headerText(summary, status),
		hint: summary.folded ? summary.hint : undefined,
		isDim: false,
	};
}

function headerText(summary: CommandGroupSummary, status: ToolStatus): string {
	const count = summary.commands.length;
	const countPart = `${COUNT_PREFIX} ${count} ${pluralize(COMMAND_NOUN, count)}`;
	const targetPart = targetText(summary);
	const durationPart =
		summary.durationMilliseconds === undefined
			? ""
			: `${DURATION_SEPARATOR}${formatCommandDuration(summary.durationMilliseconds)}`;
	const showsWord = summary.folded || count === SINGLE_COMMAND_COUNT;

	return `${countPart}${targetPart}${durationPart}${wordText(status, showsWord)}`;
}

function targetText(summary: CommandGroupSummary): string {
	const command = summary.folded ? summary.commands.at(-1)?.command : undefined;

	return command ? `${SPACE}(${toSingleLine(command)})` : "";
}

function wordText(status: ToolStatus, isShown: boolean): string {
	const word = isShown ? statusWord(status) : undefined;

	return word ? `${SPACE}${word}` : "";
}

function commandLines(commands: readonly CommandSummary[]): RowLine[] {
	const hiddenCount = Math.max(0, commands.length - NEWEST_COMMAND_LIMIT);
	const visibleCommands = hiddenCount > 0 ? commands.slice(hiddenCount) : commands;
	const lines = hiddenCount > 0 ? [overflowLine(hiddenCount)] : [];
	const isSingle = commands.length === SINGLE_COMMAND_COUNT;

	for (const command of visibleCommands) {
		lines.push(commandLine(command, isSingle));
	}

	return lines;
}

function commandLine(command: CommandSummary, isSingle: boolean): RowLine {
	return {
		indent: LINE_INDENT,
		mark: isSingle ? undefined : { glyph: commandMark(command.status), status: command.status },
		text: commandLineText(command, isSingle),
		hint: undefined,
		isDim: true,
	};
}

function commandMark(status: ToolStatus): string {
	return status === ToolStatus.Running ? RUNNING_LINE_MARK : statusMark(status);
}

function commandLineText(command: CommandSummary, isSingle: boolean): string {
	const commandPart = `${COMMAND_PROMPT}${SPACE}${toSingleLine(command.command)}`;

	if (isSingle) {
		return commandPart;
	}

	const duration = command.status === ToolStatus.Running ? undefined : command.durationMilliseconds;
	const durationPart = duration === undefined ? "" : `${SPACE}${formatCommandDuration(duration)}`;

	return `${commandPart}${durationPart}${wordText(command.status, true)}`;
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
