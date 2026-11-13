import type { SubLineSummary } from "../core/tool-view/row-group.ts";
import { ToolStatus } from "../core/tool-view/status.ts";
import { nestedCallsFor, type NestedCall } from "./nested-calls.ts";

const SCRIPT_ARGUMENT = "code";
const LINE_BREAK_PATTERN = /\r?\n/;
const WHITESPACE_PATTERN = /\s+/g;
const SPACE = " ";
const SCRIPT_PREVIEW_LENGTH = 60;

const STATUS_BY_NESTED_CALL: Readonly<Record<NestedCall["status"], ToolStatus>> = {
	running: ToolStatus.Running,
	ok: ToolStatus.Ok,
	error: ToolStatus.Failed,
};

export function codemodeSubLines(
	toolCallId: string,
	args: Record<string, unknown> | undefined,
): readonly SubLineSummary[] {
	const lines: SubLineSummary[] = [];
	const script = scriptPreview(args);

	if (script) {
		lines.push({ text: script, status: undefined });
	}

	for (const call of nestedCallsFor(toolCallId)) {
		lines.push({
			text: nestedCallText(call),
			status: STATUS_BY_NESTED_CALL[call.status],
		});
	}

	return lines;
}

function scriptPreview(args: Record<string, unknown> | undefined): string {
	const code = args?.[SCRIPT_ARGUMENT];

	if (typeof code !== "string") {
		return "";
	}

	const firstLine = code.split(LINE_BREAK_PATTERN).find((line) => line.trim().length > 0) ?? "";
	const oneLine = firstLine.replace(WHITESPACE_PATTERN, SPACE).trim();

	if (!oneLine) {
		return "";
	}

	return oneLine.length > SCRIPT_PREVIEW_LENGTH
		? `${oneLine.slice(0, SCRIPT_PREVIEW_LENGTH - 1)}…`
		: oneLine;
}

function nestedCallText(call: NestedCall): string {
	return call.detail ? `${call.name}${SPACE}${call.detail}` : call.name;
}
