import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Box, Container, MouseRegion, Spacer, Text, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { rowTarget } from "#core/tool-view/arguments.ts";
import type { SubLineSummary } from "#core/tool-view/row-group.ts";
import { ExpansionLevel, resolvedExpansionLevel } from "#core/tool-view/expansion-level.ts";
import { rowKindOf } from "#core/tool-view/row-kind.ts";
import { shortBlockReason, statusFromResult } from "#core/tool-view/status.ts";
import { ViewMode } from "#core/tool-view/view-mode.ts";
import { nativeThoughtForCall } from "./native-thought.ts";
import { RowGroupComponent } from "./row-group-component.ts";
import {
	advanceGroupExpansion,
	groupSummary,
	joinRowGroup,
	drawsSegment,
	segmentOfCall,
	rowGroupOfCall,
	settleRowGroup,
	type RowGroup,
} from "./row-groups.ts";
import { getActiveViewMode } from "./session.ts";
import { codemodeSubLines } from "./codemode-lines.ts";
import { gateNoteFor, nativeBottomNoteFor } from "#shared/gate-notes.ts";

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
const CODEMODE_TOOL_NAME = "codemode";
const SELF_RENDER_SHELL = "self";

const MAX_FALLBACK_PREVIEW_LINES = 10;

export function toolViewRenderers(toolName: string, fallback: RendererFallback): ToolRenderers {
	const isRowTool = rowKindOf(toolName) !== undefined;

	return {
		renderShell: isRowTool && getActiveViewMode() === ViewMode.Compact ? SELF_RENDER_SHELL : undefined,
		renderCall: (...parameters) => renderRowCall(toolName, fallback, parameters),
		renderResult: (...parameters) => renderRowResult(toolName, fallback, parameters),
	};
}

export function nativeGateNoteRenderers(fallback: RendererFallback): ToolRenderers {
	return {
		renderShell: fallback?.renderShell,
		renderCall: fallback?.renderCall ? (...parameters) => fallbackCall(fallback, parameters) : undefined,
		renderResult: (...parameters) => renderNativeWithNote(fallback, parameters),
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

	if (isNativeLevel(level)) {
		return nativeCallBlock(fallback, parameters, level, group);
	}

	if (isSettledCall(context)) {
		return emptyComponent();
	}

	const target = context.argsComplete ? rowTarget(toolName, args as ToolCallArguments) : undefined;

	if (!target) {
		return nativeCallBlock(fallback, parameters, ExpansionLevel.Collapsed, group);
	}

	const joined =
		group ??
		joinRowGroup({
			toolCallId: context.toolCallId,
			kind,
			target,
			invalidate: context.invalidate,
			cwd: context.cwd,
			subLines: subLinesFor(toolName, context.toolCallId, args as ToolCallArguments),
		});

	return rowComponent(joined, context, theme);
}

function renderRowResult(toolName: string, fallback: RendererFallback, parameters: ResultParameters) {
	const [result, , theme, context] = parameters;
	const kind = rowKindOf(toolName);

	if (getActiveViewMode() !== ViewMode.Compact || !kind) {
		return renderNativeWithNote(fallback, parameters);
	}

	const group = rowGroupOfCall(context.toolCallId);
	const level = expansionLevelOf(group, context);

	if (isNativeLevel(level)) {
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

	const text = resultText(result);
	const status = statusFromResult(context.isError, text);

	const settled = settleRowGroup({
		toolCallId: context.toolCallId,
		kind,
		target,
		status,
		durationMilliseconds: context.durationMs,
		blockReason: shortBlockReason(status, text),
		invalidate: context.invalidate,
		cwd: context.cwd,
		subLines: subLinesFor(toolName, context.toolCallId, context.args as ToolCallArguments),
	});

	return rowComponent(settled, context, theme);
}

function rowComponent(group: RowGroup, context: RenderContext, theme: RenderTheme) {
	if (!drawsSegment(group, context.toolCallId)) {
		return emptyComponent();
	}

	const segmentIndex = segmentOfCall(group, context.toolCallId) ?? 0;
	const hint = context.keyHint(EXPAND_KEYBINDING, EXPAND_HINT_DESCRIPTION);
	const summary = () => groupSummary(group, hint);
	const onClick = () => advanceGroupExpansion(group);

	return new RowGroupComponent(summary, theme, onClick, segmentIndex);
}

function expansionLevelOf(group: RowGroup | undefined, context: RenderContext): ExpansionLevel {
	return resolvedExpansionLevel(group?.expansionLevel ?? ExpansionLevel.Row, context.expanded);
}

function isNativeLevel(level: ExpansionLevel): boolean {
	return level === ExpansionLevel.Collapsed || level === ExpansionLevel.Full;
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

	const thought = nativeThoughtForCall(context.toolCallId);
	const paddingY = thought ? NO_PADDING : BLOCK_PADDING_Y;
	const block = new Box(context.outputPad, paddingY, nativeBackground(theme, context));

	block.addChild(callComponent);
	context.state[NATIVE_BLOCK_STATE_KEY] = block;

	if (!thought) {
		return clicking(block, group);
	}

	const view = new Container();

	view.addChild(thought);
	view.addChild(new Spacer(BLOCK_PADDING_Y));
	view.addChild(block);

	return clicking(view, group);
}

function nativeResultBlock(fallback: RendererFallback, parameters: ResultParameters, level: ExpansionLevel) {
	const [result, options, theme, context] = parameters;
	const renderPiResult = fallback?.renderResult;
	const block = context.state[NATIVE_BLOCK_STATE_KEY] as Box | undefined;

	if (!renderPiResult || !block) {
		return renderNativeWithNote(fallback, parameters);
	}

	const isFull = level === ExpansionLevel.Full;
	const lastComponent = context.state[PI_RESULT_STATE_KEY] as Component | undefined;
	const resultComponent = renderPiResult(result, { ...options, expanded: isFull }, theme, {
		...context,
		expanded: isFull,
		lastComponent,
	});

	context.state[PI_RESULT_STATE_KEY] = resultComponent;
	block.addChild(resultComponent);
	addGateNote(block, theme, context);

	return emptyComponent();
}

function addGateNote(block: Box, theme: RenderTheme, context: RenderContext): void {
	const note = nativeBottomNoteFor(context.toolCallId) ?? gateNoteFor(context.toolCallId);

	if (!note) {
		return;
	}

	block.addChild(new Text(theme.fg("warning", note), NO_PADDING, NO_PADDING));
}

function renderNativeWithNote(fallback: RendererFallback, parameters: ResultParameters): Component {
	const [result, options, theme, context] = parameters;
	const note = nativeBottomNoteFor(context.toolCallId) ?? gateNoteFor(context.toolCallId);
	const renderPiResult = fallback?.renderResult;

	let resultComponent: Component;

	if (renderPiResult) {
		const lastComponent = context.state[PI_RESULT_STATE_KEY] as Component | undefined;
		resultComponent = renderPiResult(result, options, theme, {
			...context,
			lastComponent,
		});
		context.state[PI_RESULT_STATE_KEY] = resultComponent;
	} else {
		resultComponent = fallbackPlainResult(result, options.expanded, theme);
	}

	if (!note) {
		return resultComponent;
	}

	const container = new Container();
	const paddingX = fallback?.renderShell === SELF_RENDER_SHELL ? context.outputPad : NO_PADDING;

	container.addChild(resultComponent);
	container.addChild(new Text(theme.fg("warning", note), paddingX, NO_PADDING));

	return container;
}

function fallbackPlainResult(result: ResultParameters[0], expanded: boolean, theme: RenderTheme): Component {
	const text = resultText(result).trim();

	if (!text) {
		return emptyComponent();
	}

	const lines = text.split("\n");
	const shown = expanded ? lines : lines.slice(0, MAX_FALLBACK_PREVIEW_LINES);
	const remaining = lines.length - shown.length;
	const preview = shown.map((line) => theme.fg("toolOutput", line)).join("\n");
	const suffix = remaining > 0 ? theme.fg("muted", `\n... (${remaining} more lines)`) : EMPTY_LINE;

	return new Text(`${preview}${suffix}`, NO_PADDING, NO_PADDING);
}

function nativeBackground(theme: RenderTheme, context: RenderContext): (line: string) => string {
	if (context.isPartial) {
		return (line) => theme.bg(PENDING_BACKGROUND, line);
	}

	const background = context.isError ? ERROR_BACKGROUND : SUCCESS_BACKGROUND;

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

function subLinesFor(toolName: string, toolCallId: string, args: ToolCallArguments): SubLineSummary[] | undefined {
	if (toolName !== CODEMODE_TOOL_NAME) {
		return undefined;
	}

	return [...codemodeSubLines(toolCallId, args)];
}

function resultText(result: ResultParameters[0]): string {
	const contentBlocks = (result.content ?? []) as readonly ResultContentBlock[];

	return contentBlocks
		.filter((block) => block.type === TEXT_BLOCK_TYPE)
		.map((block) => block.text ?? "")
		.join(BLOCK_SEPARATOR);
}
