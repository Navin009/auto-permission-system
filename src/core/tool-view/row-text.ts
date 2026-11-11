import { formatDuration } from "./duration.ts";
import { StatusMark } from "./status.ts";

export interface RowDescription {
	verb: string;
	noun: string;
	count: number;
	target: string | undefined;
	command: string | undefined;
	durationMilliseconds: number | undefined;
	status: StatusMark;
	hint: string | undefined;
}

export interface RowText {
	lead: string;
	status: StatusMark;
	hint: string | undefined;
	commandLine: string | undefined;
}

const GUTTER_RUNNING = "● ";
const GUTTER_IDLE = " ";
const COMMAND_LINE_INDENT = "   ";
const COMMAND_LINE_BRANCH = "└";
const COMMAND_PREFIX = "$";
const PLURAL_ENDING = "s";
const PLURAL_Y_ENDING = "ies";

export function pluralize(noun: string, count: number): string {
	if (count === 1) {
		return noun;
	}

	return noun.endsWith("y") ? `${noun.slice(0, -1)}${PLURAL_Y_ENDING}` : `${noun}${PLURAL_ENDING}`;
}

export function buildRowText(description: RowDescription): RowText {
	const isRunning = description.status === StatusMark.Running;
	const gutter = isRunning ? GUTTER_RUNNING : GUTTER_IDLE;
	const countedNoun = `${description.count} ${pluralize(description.noun, description.count)}`;
	const targetPart = description.target ? ` (${description.target})` : "";
	const duration = description.durationMilliseconds;
	const durationPart = duration === undefined ? "" : ` · ${formatDuration(duration)}`;

	return {
		lead: `${gutter}${description.verb} ${countedNoun}${targetPart}${durationPart}`,
		status: description.status,
		hint: description.hint,
		commandLine: description.command
			? `${COMMAND_LINE_INDENT}${COMMAND_LINE_BRANCH} ${COMMAND_PREFIX} ${description.command}`
			: undefined,
	};
}

export function rowLine(text: RowText): string {
	const statusPart = text.status === StatusMark.Running ? "" : ` ${text.status}`;
	const hintPart = text.hint ? ` ${text.hint}` : "";

	return `${text.lead}${statusPart}${hintPart}`;
}

export function rowLines(text: RowText): string[] {
	return text.commandLine ? [rowLine(text), text.commandLine] : [rowLine(text)];
}
