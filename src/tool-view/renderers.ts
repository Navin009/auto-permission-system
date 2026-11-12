import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Box, MouseRegion, Text, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { rowTarget } from "../core/tool-view/arguments.ts";
import { ExpansionLevel, resolvedExpansionLevel } from "../core/tool-view/expansion-level.ts";
import { rowKindOf } from "../core/tool-view/row-kind.ts";
import { statusFromResult } from "../core/tool-view/status.ts";
import { ViewMode } from "../core/tool-view/view-mode.ts";
import { RowGroupComponent } from "./row-group-component.ts";
import {
	advanceGroupExpansion,
	groupSummary,
	isGroupHead,
	joinRowGroup,
	rowGroupOfCall,
	settleRowGroup,
	type RowGroup,
} from "./row-groups.ts";
import { getActiveViewMode } from "./session.ts";

type CallRenderer = NonNullable<ToolRenderers["renderCall"]>;
type ResultRenderer = NonNullable<ToolRenderers["renderResult"]>;
type CallParameters = Parameters<CallRenderer>;
type ResultParameters = Parameters<ResultRenderer>;
type RendererFallback = ToolRenderers | undefined;
type RenderContext = CallParameters[2] | ResultParameters[3];
type RenderTheme = CallParameters[1];
type ToolCallArguments = Record<string, unknown> | undefined;
type BackgroundColor = Parameters<Theme["bg"]>[0];

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
const NATIVE_BLOCK_STATE_KEY = "nativeBlock";
const EMPTY_LINE = "";
const NO_PADDING = 0;
const BLOCK_PADDING_Y = 1;
const PENDING_BACKGROUND: BackgroundColor = "toolPendingBg";
const ERROR_BACKGROUND: BackgroundColor = "toolErrorBg";
const SUCCESS_BACKGROUND: BackgroundColor = "toolSuccessBg";

export function toolViewRenderers(toolName: string, fallback: RendererFallback): ToolRenderers {
	const isRowTool = rowKindOf(toolName) !== undefined;

	return {
		renderShell: isRowTool && getActiveViewMode() === ViewMode.Compact ? "self" : undefined,
		renderCall: (...parameters) => renderRowCall(toolName, fallback, parameters),
		renderResult: (...parameters) => renderRowResult(toolName, fallback, parameters),
	};
}

function renderRowCall(toolName: string, fallback: RendererFallback, parameters: CallParameters) {
	const [args, theme, context] = parameters;
	const kind = rowKindOf(toolName);

	if (getActiveViewMode() !== ViewMode.Compact || !kind) {
		return fallbackCall(fallback, parameters);
	}

	const group = rowGroupOfCall(context.toolCallId);
	const level = expansionLevelOf(group, context);

	if (level !== ExpansionLevel.Row) {
		return nativeCallBlock(fallback, parameters, level, group);
	}

	if (isSettledCall(context)) {
		return emptyComponent();
	}

	const target = context.argsComplete ? rowTarget(toolName, args as ToolCallArguments) : undefined;

	if (!target) {
		return nativeCallBlock(fallback, parameters, ExpansionLevel.Collapsed, group);
	}

	const joined = group ?? joinRowGroup({
		toolCallId: context.toolCallId,
		kind,
		target,
		invalidate: context.invalidate,
	});

	return rowComponent(joined, context, theme);
}

function renderRowResult(toolName: string, fallback: RendererFallback, parameters: ResultParameters) {
	const [result, , theme, context] = parameters;
	const kind = rowKindOf(toolName);

	if (getActiveViewMode() !== ViewMode.Compact || !kind) {
		return fallbackResult(fallback, parameters);
	}

	const group = rowGroupOfCall(context.toolCallId);
	const level = expansionLevelOf(group, context);

	if (level !== ExpansionLevel.Row) {
		return nativeResultBlock(fallback, parameters, level);
	}

	const target = rowTarget(toolName, context.args as ToolCallArguments);

	if (!target) {
		return nativeResultBlock(fallback, parameters, level);
	}

	if (context.isPartial) {
		return emptyComponent();
	}

	context.state[SETTLED_STATE_KEY] = true;

	const settled = settleRowGroup({
		toolCallId: context.toolCallId,
		kind,
		target,
		status: statusFromResult(context.isError, resultText(result)),
		durationMilliseconds: context.durationMs,
		invalidate: context.invalidate,
	});

	return rowComponent(settled, context, theme);
}

function rowComponent(group: RowGroup, context: RenderContext, theme: RenderTheme) {
	if (!isGroupHead(group, context.toolCallId)) {
		return emptyComponent();
	}

	const hint = context.keyHint(EXPAND_KEYBINDING, EXPAND_HINT_DESCRIPTION);
	const summary = () => groupSummary(group, hint);
	const onClick = () => advanceGroupExpansion(group);

	return new RowGroupComponent(summary, theme, onClick);
}

function expansionLevelOf(group: RowGroup | undefined, context: RenderContext): ExpansionLevel {
	return resolvedExpansionLevel(group?.expansionLevel ?? ExpansionLevel.Row, context.expanded);
}

function nativeCallBlock(
	fallback: RendererFallback,
	parameters: CallParameters,
	level: ExpansionLevel,
	group: RowGroup | undefined,
) {
	const [args, theme, context] = parameters;
	const renderPiCall = fallback?.renderCall;

	if (!renderPiCall) {
		return emptyComponent();
	}

	const lastComponent = context.state[PI_CALL_STATE_KEY] as Component | undefined;
	const callComponent = renderPiCall(args, theme, {
		...context,
		expanded: level === ExpansionLevel.Full,
		lastComponent,
	});

	context.state[PI_CALL_STATE_KEY] = callComponent;

	const block = new Box(context.outputPad, BLOCK_PADDING_Y, nativeBackground(theme, context));
	block.addChild(callComponent);
	context.state[NATIVE_BLOCK_STATE_KEY] = block;

	return clicking(block, group);
}

function nativeResultBlock(
	fallback: RendererFallback,
	parameters: ResultParameters,
	level: ExpansionLevel,
) {
	const [result, options, theme, context] = parameters;
	const renderPiResult = fallback?.renderResult;
	const block = context.state[NATIVE_BLOCK_STATE_KEY] as Box | undefined;

	if (!renderPiResult || !block) {
		return fallbackResult(fallback, parameters);
	}

	const isFull = level === ExpansionLevel.Full;
	const lastComponent = context.state[PI_RESULT_STATE_KEY] as Component | undefined;
	const resultComponent = renderPiResult(
		result,
		{ ...options, expanded: isFull },
		theme,
		{ ...context, expanded: isFull, lastComponent },
	);

	context.state[PI_RESULT_STATE_KEY] = resultComponent;
	block.addChild(resultComponent);

	return emptyComponent();
}

function nativeBackground(theme: RenderTheme, context: RenderContext): (line: string) => string {
	const background = context.isPartial
		? PENDING_BACKGROUND
		: context.isError
			? ERROR_BACKGROUND
			: SUCCESS_BACKGROUND;

	return (line) => theme.bg(background, line);
}

function clicking(component: Component, group: RowGroup | undefined): Component {
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
