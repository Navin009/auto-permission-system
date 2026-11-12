import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	truncateToWidth,
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

type MarkColor = Parameters<Theme["fg"]>[0];

export class RowGroupComponent implements Component {
	private readonly summary: () => RowGroupSummary;
	private readonly theme: Theme;
	private readonly onClick: () => void;

	constructor(summary: () => RowGroupSummary, theme: Theme, onClick: () => void) {
		this.summary = summary;
		this.theme = theme;
		this.onClick = onClick;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== CLICK_TYPE || event.button !== LEFT_BUTTON) {
			return undefined;
		}

		this.onClick();

		return { handled: true };
	}

	render(width: number): string[] {
		const lines = rowGroupLines(this.summary());

		return lines.map((line) => truncateToWidth(this.lineText(line), width, ELLIPSIS));
	}

	invalidate(): void {}

	private lineText(line: RowLine): string {
		const indent = line.indent ? this.theme.fg("dim", line.indent) : "";
		const mark = line.mark ? this.markText(line.mark) : "";
		const text = line.isDim ? this.theme.fg("dim", line.text) : line.text;
		const hint = line.hint ? `${SPACE}${this.theme.fg("dim", line.hint)}` : "";

		return `${indent}${mark}${text}${hint}`;
	}

	private markText(mark: RowMark): string {
		return `${this.theme.fg(colorForStatus(mark.status), mark.glyph)}${SPACE}`;
	}
}

function colorForStatus(status: ToolStatus): MarkColor {
	if (status === ToolStatus.Running) {
		return "accent";
	}

	return status === ToolStatus.Ok ? "success" : "error";
}
