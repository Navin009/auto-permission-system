import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	truncateToWidth,
	visibleWidth,
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
const CLICK_TYPE = "click";
const LEFT_BUTTON = "left";

type TextColor = Parameters<Theme["fg"]>[0];

export class RowGroupComponent implements Component {
	private readonly summary: () => RowGroupSummary;
	private readonly theme: Theme;
	private readonly onClick: () => void;
	private readonly onThoughtClick: (thoughtIndex: number) => void;
	private lines: readonly RowLine[] = [];

	constructor(
		summary: () => RowGroupSummary,
		theme: Theme,
		onClick: () => void,
		onThoughtClick: (thoughtIndex: number) => void,
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

		const thoughtIndex = this.lines[event.y]?.thoughtIndex;

		if (thoughtIndex === undefined) {
			this.onClick();
			return { handled: true };
		}

		this.onThoughtClick(thoughtIndex);

		return { handled: true };
	}

	render(width: number): string[] {
		this.lines = rowGroupLines(this.summary(), width);

		return this.lines.map((line) => this.lineText(line, width));
	}

	invalidate(): void {}

	private lineText(line: RowLine, width: number): string {
		const tail = this.tailText(line);
		const head = truncateToWidth(this.headText(line), Math.max(1, width - visibleWidth(tail)), ELLIPSIS);

		if (!tail) {
			return head;
		}

		const padding = SPACE.repeat(Math.max(SPACE.length, width - visibleWidth(head) - visibleWidth(tail)));

		return `${head}${padding}${tail}`;
	}

	private headText(line: RowLine): string {
		const indent = line.indent ? this.theme.fg("dim", line.indent) : "";
		const mark = line.mark ? this.markText(line.mark) : "";

		return `${indent}${mark}${this.bodyText(line)}`;
	}

	private bodyText(line: RowLine): string {
		if (line.isItalic) {
			return this.theme.italic(this.theme.fg("thinkingText", line.text));
		}

		return line.isDim ? this.theme.fg("dim", line.text) : line.text;
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
