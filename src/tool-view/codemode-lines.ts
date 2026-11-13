import type { SubLineSummary } from "../core/tool-view/row-group.ts";
import { scriptLine } from "../core/tool-view/script-line.ts";
import { ToolStatus } from "../core/tool-view/status.ts";
import { nestedCallsFor, type NestedCall } from "./nested-calls.ts";

const SCRIPT_ARGUMENT = "code";
const SPACE = " ";

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

	return typeof code === "string" ? scriptLine(code) : "";
}

function nestedCallText(call: NestedCall): string {
	return call.detail ? `${call.name}${SPACE}${call.detail}` : call.name;
}
