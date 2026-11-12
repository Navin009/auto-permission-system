import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	truncateToWidth,
	visibleWidth,
	type Component,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import {
	rowGroupLinesForSegment,
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
	private readonly segmentIndex: number;

	constructor(
		summary: () => RowGroupSummary,
		theme: Theme,
		onClick: () => void,
		segmentIndex: number,
	) {
		this.summary = summary;
		this.theme = theme;
		this.onClick = onClick;
		this.segmentIndex = segmentIndex;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== CLICK_TYPE || event.button !== LEFT_BUTTON) {
			return undefined;
		}

		this.onClick();

		return { handled: true };
	}

	render(width: number): string[] {
		const lines = rowGroupLinesForSegment(this.summary(), width, this.segmentIndex);

		return lines.map((line) => this.lineText(line, width));
	}

	invalidate(): void {}

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
