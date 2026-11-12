import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import {
	rowGroupLines,
	type RowGroupSummary,
	type RowLine,
	type RowMark,
} from "../core/tool-view/row-group.ts";
import { ToolStatus } from "../core/tool-view/status.ts";

const ELLIPSIS = "…";
const SPACE = " ";
const BLANK = "";
const CLICK_TYPE = "click";
const LEFT_BUTTON = "left";
const THOUGHT_BODY_INDENT = "    ";
const THOUGHT_BODY_MAX_LINES = 6;
const TRUNCATED_THOUGHT_MARK = `${THOUGHT_BODY_INDENT}…`;
const MINIMUM_BODY_WIDTH = 1;

type TextColor = Parameters<Theme["fg"]>[0];
type RenderedLineKind = "thought" | "thoughtBody" | "other";

export class RowGroupComponent implements Component {
	private readonly summary: () => RowGroupSummary;
	private readonly theme: Theme;
	private readonly onClick: () => void;
	private readonly onThoughtClick: () => void;
	private renderedKinds: RenderedLineKind[] = [];

	constructor(
		summary: () => RowGroupSummary,
		theme: Theme,
		onClick: () => void,
		onThoughtClick: () => void,
	) {
		this.summary = summary;
		this.theme = theme;
		this.onClick = onClick;
		this.onThoughtClick = onThoughtClick;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== CLICK_TYPE || event.button !== LEFT_BUTTON) {
			return undefined;
		}

		if (this.isThoughtLine(event.y)) {
			this.onThoughtClick();

			return { handled: true };
		}

		this.onClick();

		return { handled: true };
	}

	render(width: number): string[] {
		const lines = rowGroupLines(this.summary(), width);
		const rendered: string[] = [];
		const kinds: RenderedLineKind[] = [];

		for (const line of lines) {
			rendered.push(this.lineText(line, width));
			kinds.push(line.isThought ? "thought" : "other");

			for (const bodyLine of this.thoughtBodyLines(line, width)) {
				rendered.push(bodyLine);
				kinds.push("thoughtBody");
			}
		}

		this.renderedKinds = kinds;

		return rendered;
	}

	invalidate(): void {}

	private isThoughtLine(row: number): boolean {
		const kind = this.renderedKinds[row];

		return kind === "thought" || kind === "thoughtBody";
	}

	private thoughtBodyLines(line: RowLine, width: number): string[] {
		const text = line.thoughtText ?? BLANK;

		if (!line.isThought || !line.thoughtExpanded || !text) {
			return [];
		}

		const budget = Math.max(MINIMUM_BODY_WIDTH, width - THOUGHT_BODY_INDENT.length);
		const wrapped = wrapTextWithAnsi(text, budget);
		const shown = wrapped.slice(-THOUGHT_BODY_MAX_LINES);
		const lines = shown.length < wrapped.length ? [this.theme.fg("dim", TRUNCATED_THOUGHT_MARK)] : [];

		for (const bodyLine of shown) {
			lines.push(`${THOUGHT_BODY_INDENT}${this.thoughtText(bodyLine)}`);
		}

		return lines;
	}

	private lineText(line: RowLine, width: number): string {
		const tail = this.tailText(line);

		if (!tail) {
			return truncateToWidth(this.headText(line), width, ELLIPSIS);
		}

		const tailSeparator = SPACE;
		const headWidth = Math.max(1, width - visibleWidth(tail) - tailSeparator.length);
		const head = truncateToWidth(this.headText(line), headWidth, ELLIPSIS);

		return `${head}${tailSeparator}${tail}`;
	}

	private headText(line: RowLine): string {
		const indent = line.indent ? this.theme.fg("dim", line.indent) : "";
		const mark = line.mark ? this.markText(line.mark) : "";

		return `${indent}${mark}${this.bodyText(line)}`;
	}

	private bodyText(line: RowLine): string {
		if (line.isThought) {
			return this.thoughtText(line.text);
		}

		return line.isDim ? this.theme.fg("dim", line.text) : line.text;
	}

	private thoughtText(line: string): string {
		return this.theme.italic(this.theme.fg("thinkingText", line));
	}

	private tailText(line: RowLine): string {
		const hint = line.hint ? `${this.theme.fg("dim", line.hint)}${SPACE}` : "";
		const duration = line.duration ? this.theme.fg("dim", line.duration) : "";

		return `${hint}${duration}`;
	}

	private markText(mark: RowMark): string {
		return `${this.theme.fg(colorForStatus(mark.status), mark.glyph)}${SPACE}`;
	}
}

function colorForStatus(status: ToolStatus): TextColor {
	if (status === ToolStatus.Running) {
		return "accent";
	}

	return status === ToolStatus.Ok ? "success" : "error";
}
