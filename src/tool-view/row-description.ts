import { homedir } from "node:os";
import { callCommand, callTarget, shortenTarget } from "../core/tool-view/arguments.ts";
import { toolLabelFor } from "../core/tool-view/labels.ts";
import type { RowDescription } from "../core/tool-view/row-text.ts";
import type { StatusMark } from "../core/tool-view/status.ts";

const SINGLE_CALL_COUNT = 1;

export interface RowSource {
	toolName: string;
	args: Record<string, unknown> | undefined;
	cwd: string;
	status: StatusMark;
	durationMilliseconds: number | undefined;
	hint: string | undefined;
}

export function describeRow(source: RowSource): RowDescription | undefined {
	const label = toolLabelFor(source.toolName);

	if (!label) {
		return undefined;
	}

	const target = callTarget(source.toolName, source.args);

	return {
		verb: label.verb,
		noun: label.noun,
		count: SINGLE_CALL_COUNT,
		target: target ? shortenTarget(target, source.cwd, homedir()) : undefined,
		command: callCommand(source.toolName, source.args),
		durationMilliseconds: source.durationMilliseconds,
		status: source.status,
		hint: label.showsExpandHint ? source.hint : undefined,
	};
}
