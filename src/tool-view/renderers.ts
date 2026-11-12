import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import { callCommand } from "../core/tool-view/arguments.ts";
import { statusFromResult } from "../core/tool-view/status.ts";
import { ViewMode } from "../core/tool-view/view-mode.ts";
import { CommandGroupComponent } from "./command-group-component.ts";
import { groupSummary, isGroupHead, joinCommandGroup, settleCommandGroup, type CommandGroup } from "./command-groups.ts";
import { PiBlockComponent, toolBackground } from "./pi-block.ts";
import { getActiveViewMode } from "./session.ts";

type CallRenderer = NonNullable<ToolRenderers["renderCall"]>;
type ResultRenderer = NonNullable<ToolRenderers["renderResult"]>;
type CallParameters = Parameters<CallRenderer>;
type ResultParameters = Parameters<ResultRenderer>;
type RendererFallback = ToolRenderers | undefined;
type RenderContext = CallParameters[2] | ResultParameters[3];
type RenderTheme = CallParameters[1];
type ToolCallArguments = Record<string, unknown> | undefined;

interface ResultContentBlock {
	type: string;
	text?: string;
}

const EXPAND_KEYBINDING = "app.tools.expand";
const EXPAND_HINT_DESCRIPTION = "to expand";
const TEXT_BLOCK_TYPE = "text";
const BLOCK_SEPARATOR = " ";
const SETTLED_STATE_KEY = "settled";
const PI_BLOCK_STATE_KEY = "piBlock";
const EMPTY_LINE = "";
const NO_PADDING = 0;

export function toolViewRenderers(toolName: string, fallback: RendererFallback): ToolRenderers {
	return {
		renderShell: "self",
		renderCall: (...parameters) => renderCall(toolName, fallback, parameters),
		renderResult: (...parameters) => renderResult(toolName, fallback, parameters),
	};
}

function renderCall(toolName: string, fallback: RendererFallback, parameters: CallParameters) {
	const [args, theme, context] = parameters;

	if (getActiveViewMode() !== ViewMode.Compact || !context.argsComplete) {
		return fallbackCall(fallback, parameters);
	}

	if (context.expanded) {
		return expandedCall(fallback, parameters);
	}

	if (isSettledCall(context)) {
		return emptyComponent();
	}

	const command = callCommand(toolName, args as ToolCallArguments);

	if (!command) {
		return fallbackCall(fallback, parameters);
	}

	const group = joinCommandGroup({
		toolCallId: context.toolCallId,
		command,
		invalidate: context.invalidate,
	});

	return groupComponent(group, context, theme);
}

function renderResult(toolName: string, fallback: RendererFallback, parameters: ResultParameters) {
	const [result, options, theme, context] = parameters;

	if (getActiveViewMode() !== ViewMode.Compact) {
		return fallbackResult(fallback, parameters);
	}

	if (options.expanded) {
		return expandedResult(fallback, parameters);
	}

	context.state[SETTLED_STATE_KEY] = true;

	const command = callCommand(toolName, context.args as ToolCallArguments);

	if (!command) {
		return fallbackResult(fallback, parameters);
	}

	const group = settleCommandGroup({
		toolCallId: context.toolCallId,
		command,
		status: statusFromResult(context.isError, resultText(result)),
		durationMilliseconds: context.durationMs,
		invalidate: context.invalidate,
	});

	return groupComponent(group, context, theme);
}

function groupComponent(group: CommandGroup, context: RenderContext, theme: RenderTheme) {
	if (!isGroupHead(group, context.toolCallId)) {
		return emptyComponent();
	}

	const hint = context.keyHint(EXPAND_KEYBINDING, EXPAND_HINT_DESCRIPTION);

	return new CommandGroupComponent(() => groupSummary(group, hint), theme);
}

function expandedCall(fallback: RendererFallback, parameters: CallParameters) {
	const [args, theme, context] = parameters;

	if (!fallback?.renderCall) {
		return fallbackCall(fallback, parameters);
	}

	const background = toolBackground(context);
	const block = piBlock(context) ?? new PiBlockComponent(theme, context.outputPad, background);

	block.setBackground(background);
	block.setCall(fallback.renderCall(args, theme, delegatedContext(context, block.callComponent)));

	context.state[PI_BLOCK_STATE_KEY] = block;

	return block;
}

function expandedResult(fallback: RendererFallback, parameters: ResultParameters) {
	const [result, options, theme, context] = parameters;
	const block = piBlock(context);

	if (!fallback?.renderResult || !block) {
		return fallbackResult(fallback, parameters);
	}

	block.setBackground(toolBackground(context));
	block.setResult(fallback.renderResult(result, options, theme, delegatedContext(context, block.resultComponent)));

	return emptyComponent();
}

function piBlock(context: RenderContext): PiBlockComponent | undefined {
	if (context.lastComponent instanceof PiBlockComponent) {
		return context.lastComponent;
	}

	const stored = context.state[PI_BLOCK_STATE_KEY];

	return stored instanceof PiBlockComponent ? stored : undefined;
}

function delegatedContext<T extends RenderContext>(context: T, lastComponent: Component | undefined): T {
	return { ...context, lastComponent };
}

function isSettledCall(context: RenderContext): boolean {
	return context.durationMs !== undefined || context.isError || context.state[SETTLED_STATE_KEY] === true;
}

function emptyComponent(): Text {
	return new Text(EMPTY_LINE, NO_PADDING, NO_PADDING);
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
