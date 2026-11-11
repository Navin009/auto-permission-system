import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { StatusMark, statusFromResult } from "../core/tool-view/status.ts";
import { ViewMode } from "../core/tool-view/view-mode.ts";
import { beginCall, elapsedMilliseconds, endCall } from "./live-clock.ts";
import { describeRow } from "./row-description.ts";
import { ToolRowComponent } from "./row-component.ts";
import { getActiveViewMode } from "./session.ts";

type CallRenderer = NonNullable<ToolRenderers["renderCall"]>;
type ResultRenderer = NonNullable<ToolRenderers["renderResult"]>;
type CallParameters = Parameters<CallRenderer>;
type ResultParameters = Parameters<ResultRenderer>;
type RendererFallback = ToolRenderers | undefined;

interface ResultContentBlock {
	type: string;
	text?: string;
}

const EXPAND_KEYBINDING = "app.tools.expand";
const EXPAND_HINT_DESCRIPTION = "to expand";
const TEXT_BLOCK_TYPE = "text";
const BLOCK_SEPARATOR = " ";

export function toolViewRenderers(toolName: string, fallback: RendererFallback): ToolRenderers {
	return {
		renderShell: "self",
		renderCall: (...parameters) => renderCall(toolName, fallback, parameters),
		renderResult: (...parameters) => renderResult(toolName, fallback, parameters),
	};
}

function renderCall(toolName: string, fallback: RendererFallback, parameters: CallParameters) {
	const [args, theme, context] = parameters;
	const expandHint = context.keyHint(EXPAND_KEYBINDING, EXPAND_HINT_DESCRIPTION);

	if (getActiveViewMode() !== ViewMode.Compact || context.expanded || !context.argsComplete) {
		return fallbackCall(fallback, parameters);
	}

	beginCall(context.toolCallId, context.invalidate);

	const description = describeRow({
		toolName,
		args: args as Record<string, unknown>,
		cwd: context.cwd,
		status: StatusMark.Running,
		durationMilliseconds: elapsedMilliseconds(context.toolCallId),
		hint: expandHint,
	});

	if (!description) {
		return fallbackCall(fallback, parameters);
	}

	return new ToolRowComponent(description, theme);
}

function renderResult(toolName: string, fallback: RendererFallback, parameters: ResultParameters) {
	const [result, options, theme, context] = parameters;
	const expandHint = context.keyHint(EXPAND_KEYBINDING, EXPAND_HINT_DESCRIPTION);

	if (getActiveViewMode() !== ViewMode.Compact || options.expanded) {
		return fallbackResult(fallback, parameters);
	}

	endCall(context.toolCallId);

	const description = describeRow({
		toolName,
		args: context.args as Record<string, unknown>,
		cwd: context.cwd,
		status: statusFromResult(context.isError, resultText(result)),
		durationMilliseconds: context.durationMs,
		hint: expandHint,
	});

	if (!description) {
		return fallbackResult(fallback, parameters);
	}

	return new ToolRowComponent(description, theme);
}

function fallbackCall(fallback: RendererFallback, parameters: CallParameters) {
	return fallback?.renderCall?.(...parameters) ?? new Text("");
}

function fallbackResult(fallback: RendererFallback, parameters: ResultParameters) {
	return fallback?.renderResult?.(...parameters) ?? new Text("");
}

function resultText(result: ResultParameters[0]): string {
	const contentBlocks = (result.content ?? []) as readonly ResultContentBlock[];

	return contentBlocks
		.filter((block) => block.type === TEXT_BLOCK_TYPE)
		.map((block) => block.text ?? "")
		.join(BLOCK_SEPARATOR);
}
