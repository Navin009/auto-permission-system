import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import { MouseRegion, Text, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { callCommand } from "../core/tool-view/arguments.ts";
import { ExpansionLevel, resolvedExpansionLevel } from "../core/tool-view/expansion-level.ts";
import { statusFromResult } from "../core/tool-view/status.ts";
import { ViewMode } from "../core/tool-view/view-mode.ts";
import { CommandGroupComponent } from "./command-group-component.ts";
import {
	advanceGroupExpansion,
	groupOfCall,
	groupSummary,
	isGroupHead,
	joinCommandGroup,
	settleCommandGroup,
	type CommandGroup,
} from "./command-groups.ts";
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
const CLICK_TYPE = "click";
const LEFT_BUTTON = "left";
const TEXT_BLOCK_TYPE = "text";
const BLOCK_SEPARATOR = " ";
const SETTLED_STATE_KEY = "settled";
const PI_CALL_STATE_KEY = "piCall";
const PI_RESULT_STATE_KEY = "piResult";
const EMPTY_LINE = "";
const NO_PADDING = 0;

export function toolViewRenderers(toolName: string, fallback: RendererFallback): ToolRenderers {
	return {
		renderShell: getActiveViewMode() === ViewMode.Compact ? "self" : undefined,
		renderCall: (...parameters) => renderCall(toolName, fallback, parameters),
		renderResult: (...parameters) => renderResult(toolName, fallback, parameters),
	};
}

function renderCall(toolName: string, fallback: RendererFallback, parameters: CallParameters) {
	const [args, theme, context] = parameters;

	if (getActiveViewMode() !== ViewMode.Compact || !context.argsComplete) {
		return fallbackCall(fallback, parameters);
	}

	const group = groupOfCall(context.toolCallId);
	const level = expansionLevelOf(group, context);

	if (level !== ExpansionLevel.Row) {
		return piCall(fallback, parameters, level, group);
	}

	if (isSettledCall(context)) {
		return emptyComponent();
	}

	const command = callCommand(toolName, args as ToolCallArguments);

	if (!command) {
		return fallbackCall(fallback, parameters);
	}

	const joined = group ?? joinCommandGroup({
		toolCallId: context.toolCallId,
		command,
		invalidate: context.invalidate,
	});

	return groupComponent(joined, context, theme);
}

function renderResult(toolName: string, fallback: RendererFallback, parameters: ResultParameters) {
	const [result, , theme, context] = parameters;

	if (getActiveViewMode() !== ViewMode.Compact) {
		return fallbackResult(fallback, parameters);
	}

	context.state[SETTLED_STATE_KEY] = true;

	const group = groupOfCall(context.toolCallId);
	const level = expansionLevelOf(group, context);

	if (level !== ExpansionLevel.Row) {
		return piResult(fallback, parameters, level, group);
	}

	const command = callCommand(toolName, context.args as ToolCallArguments);

	if (!command) {
		return fallbackResult(fallback, parameters);
	}

	const settled = settleCommandGroup({
		toolCallId: context.toolCallId,
		command,
		status: statusFromResult(context.isError, resultText(result)),
		durationMilliseconds: context.durationMs,
		invalidate: context.invalidate,
	});

	return groupComponent(settled, context, theme);
}

function groupComponent(group: CommandGroup, context: RenderContext, theme: RenderTheme) {
	if (!isGroupHead(group, context.toolCallId)) {
		return emptyComponent();
	}

	const hint = context.keyHint(EXPAND_KEYBINDING, EXPAND_HINT_DESCRIPTION);
	const summary = () => groupSummary(group, hint);
	const onClick = () => advanceGroupExpansion(group);

	return new CommandGroupComponent(summary, theme, onClick);
}

function expansionLevelOf(group: CommandGroup | undefined, context: RenderContext): ExpansionLevel {
	return resolvedExpansionLevel(group?.expansionLevel ?? ExpansionLevel.Row, context.expanded);
}

function piCall(
	fallback: RendererFallback,
	parameters: CallParameters,
	level: ExpansionLevel,
	group: CommandGroup | undefined,
) {
	const [args, theme, context] = parameters;
	const renderPiCall = fallback?.renderCall;

	if (!renderPiCall) {
		return emptyComponent();
	}

	const lastComponent = context.state[PI_CALL_STATE_KEY] as Component | undefined;
	const component = renderPiCall(args, theme, {
		...context,
		expanded: level === ExpansionLevel.Full,
		lastComponent,
	});

	context.state[PI_CALL_STATE_KEY] = component;

	return clicking(component, group);
}

function piResult(
	fallback: RendererFallback,
	parameters: ResultParameters,
	level: ExpansionLevel,
	group: CommandGroup | undefined,
) {
	const [result, options, theme, context] = parameters;
	const renderPiResult = fallback?.renderResult;

	if (!renderPiResult) {
		return emptyComponent();
	}

	const isFull = level === ExpansionLevel.Full;
	const lastComponent = context.state[PI_RESULT_STATE_KEY] as Component | undefined;
	const expandedContext = { ...context, expanded: isFull, lastComponent };
	const component = renderPiResult(result, { ...options, expanded: isFull }, theme, expandedContext);

	context.state[PI_RESULT_STATE_KEY] = component;

	return clicking(component, group);
}

function clicking(component: Component, group: CommandGroup | undefined): Component {
	if (!group) {
		return component;
	}

	return new MouseRegion(component, (event: TuiMouseEvent) => {
		if (event.type !== CLICK_TYPE || event.button !== LEFT_BUTTON) {
			return undefined;
		}

		advanceGroupExpansion(group);

		return { handled: true };
	});
}

function isSettledCall(context: RenderContext): boolean {
	const hasDuration = context.durationMs !== undefined;
	const isSettled = context.state[SETTLED_STATE_KEY] === true;

	return hasDuration || context.isError || isSettled;
}

function emptyComponent(): Text {
	return new Text(EMPTY_LINE, NO_PADDING, NO_PADDING);
}

function fallbackCall(fallback: RendererFallback, parameters: CallParameters) {
	return fallback?.renderCall?.(...parameters) ?? emptyComponent();
}

function fallbackResult(fallback: RendererFallback, parameters: ResultParameters) {
	return fallback?.renderResult?.(...parameters) ?? emptyComponent();
}

function resultText(result: ResultParameters[0]): string {
	const contentBlocks = (result.content ?? []) as readonly ResultContentBlock[];

	return contentBlocks
		.filter((block) => block.type === TEXT_BLOCK_TYPE)
		.map((block) => block.text ?? "")
		.join(BLOCK_SEPARATOR);
}
