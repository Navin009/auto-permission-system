import type { SubLineSummary } from "#core/tool-view/row-group.ts";
import { scriptLine } from "#core/tool-view/script-line.ts";
import { ToolStatus } from "#core/tool-view/status.ts";
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
	const script = scriptPreview(args);
	const leading: SubLineSummary[] = script ? [{ text: script, status: undefined, kind: "script" }] : [];

	return mergeNestedSubLines(toolCallId, leading);
}

export function mergeNestedSubLines(
	toolCallId: string,
	existingSubLines: readonly SubLineSummary[],
): readonly SubLineSummary[] {
	const calls = nestedCallsFor(toolCallId);

	if (calls.length === 0) {
		return existingSubLines;
	}

	const leadingScript = existingSubLines[0]?.kind === "script" ? [existingSubLines[0]] : [];

	return [
		...leadingScript,
		...calls.map((call) => ({
			text: nestedCallText(call),
			status: STATUS_BY_NESTED_CALL[call.status],
			kind: "call" as const,
			detail: call.detail || undefined,
		})),
	];
}

function scriptPreview(args: Record<string, unknown> | undefined): string {
	const code = args?.[SCRIPT_ARGUMENT];

	return typeof code === "string" ? scriptLine(code) : "";
}

function nestedCallText(call: NestedCall): string {
	return call.detail ? `${call.name}${SPACE}${call.detail}` : call.name;
}
