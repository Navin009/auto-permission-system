import { formatCommandDuration } from "./duration.ts";
import { StatusMark } from "./status.ts";
import { thinkingPart, type ThinkingState } from "./thinking.ts";

export interface CommandSummary {
	command: string;
	status: StatusMark;
	durationMilliseconds: number | undefined;
}

export interface CommandGroupSummary {
	commands: readonly CommandSummary[];
	totalDurationMilliseconds: number | undefined;
	hint: string | undefined;
	thinking: ThinkingState | undefined;
}

export interface CommandLine {
	mark: string;
	text: string;
	status: StatusMark;
}

export interface CommandGroupText {
	mark: string;
	count: string;
	thinking: string | undefined;
	duration: string | undefined;
	body: string;
	status: StatusMark;
	hint: string | undefined;
	overflowLine: string | undefined;
	commandLines: readonly CommandLine[];
}

export interface HeaderParts {
	count: string;
	thinking: string | undefined;
	duration: string | undefined;
}

const NEWEST_COMMAND_LIMIT = 8;
const SINGLE_COMMAND_COUNT = 1;
const EMPTY_MARK = "";
const DURATION_SEPARATOR = " · ";
const OVERFLOW_MARK = "...";
const COMMAND_NOUN = "command";
const EARLIER_CALL_NOUN = "call";
const RUNNING_MARK = "●";
const RUNNING_COMMAND_MARK = "…";
const COMMAND_LINE_INDENT = "   ";
const COMMAND_LINE_BRANCH = "└";
const COMMAND_LINE_SPACE = " ";
const COMMAND_PREFIX = "$";
const PLURAL_ENDING = "s";
const PLURAL_Y_ENDING = "ies";
const THINKING_OPEN = " (";
const THINKING_CLOSE = ")";

export function commandGroupText(summary: CommandGroupSummary): CommandGroupText {
	const commands = summary.commands;
	const commandCount = commands.length;
	const hiddenCount = Math.max(0, commandCount - NEWEST_COMMAND_LIMIT);
	const visibleCommands = hiddenCount > 0 ? commands.slice(hiddenCount) : commands;
	const status = groupStatus(commands, summary.thinking !== undefined);
	const count = `Running ${commandCount} ${pluralize(COMMAND_NOUN, commandCount)}`;
	const thinking = summary.thinking ? thinkingPart(summary.thinking) : undefined;
	const duration = bareDuration(summary.totalDurationMilliseconds);

	return {
		mark: statusMark(status),
		count,
		thinking,
		duration,
		body: headerBody({ count, thinking, duration }),
		status,
		hint: commandCount > SINGLE_COMMAND_COUNT ? summary.hint : undefined,
		overflowLine: hiddenCount > 0 ? overflowLine(hiddenCount) : undefined,
		commandLines: visibleCommands.map((command) => commandLine(command, commandCount)),
	};
}

export function headerBody(parts: HeaderParts): string {
	const thinking = parts.thinking ? `${THINKING_OPEN}${parts.thinking}${THINKING_CLOSE}` : "";
	const duration = parts.duration ? `${DURATION_SEPARATOR}${parts.duration}` : "";

	return `${parts.count}${thinking}${duration}`;
}

export function commandLinePrefix(): string {
	return `${COMMAND_LINE_INDENT}${COMMAND_LINE_BRANCH}${COMMAND_LINE_SPACE}`;
}

export function statusMark(status: StatusMark): string {
	return status === StatusMark.Running ? RUNNING_MARK : status;
}

export function pluralize(noun: string, count: number): string {
	if (count === 1) {
		return noun;
	}

	return noun.endsWith("y") ? `${noun.slice(0, -1)}${PLURAL_Y_ENDING}` : `${noun}${PLURAL_ENDING}`;
}

function commandLine(command: CommandSummary, commandCount: number): CommandLine {
	const showsState = commandCount > SINGLE_COMMAND_COUNT;
	const mark = showsState ? commandMark(command.status) : EMPTY_MARK;
	const duration = showsState ? durationPart(command.durationMilliseconds) : "";

	return {
		mark,
		text: `${COMMAND_PREFIX}${COMMAND_LINE_SPACE}${command.command}${duration}`,
		status: command.status,
	};
}

function commandMark(status: StatusMark): string {
	return status === StatusMark.Running ? RUNNING_COMMAND_MARK : statusMark(status);
}

function groupStatus(commands: readonly CommandSummary[], thinking: boolean): StatusMark {
	const marks = commands.map((command) => command.status);
	const order = [StatusMark.Denied, StatusMark.Blocked, StatusMark.Failed, StatusMark.Running];

	if (thinking) {
		return order.find((candidate) => marks.includes(candidate)) ?? StatusMark.Running;
	}

	return order.find((candidate) => marks.includes(candidate)) ?? StatusMark.Ok;
}

function durationPart(milliseconds: number | undefined): string {
	return milliseconds === undefined ? "" : `${DURATION_SEPARATOR}${formatCommandDuration(milliseconds)}`;
}

function bareDuration(milliseconds: number | undefined): string | undefined {
	return milliseconds === undefined ? undefined : formatCommandDuration(milliseconds);
}

function overflowLine(hiddenCount: number): string {
	return `${commandLinePrefix()}${OVERFLOW_MARK} (${hiddenCount} earlier ${pluralize(EARLIER_CALL_NOUN, hiddenCount)})`;
}
