import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	truncateToWidth,
	visibleWidth,
	type Component,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import {
	HINT_SEPARATOR,
	rowGroupLinesForSegment,
	type RowGroupSummary,
	type RowLine,
	type RowMark,
	type RowSpan,
	type SpanTone,
} from "#core/tool-view/row-group.ts";
import { ToolStatus } from "#core/tool-view/status.ts";

const ELLIPSIS = "…";
const SPACE = " ";
const BLANK = "";
const CLICK_TYPE = "click";
const LEFT_BUTTON = "left";
const MIN_HEAD_WIDTH = 1;

type TextColor = Parameters<Theme["fg"]>[0];

const COLOR_BY_TONE: Readonly<Record<SpanTone, TextColor | undefined>> = {
	title: "toolTitle",
	text: undefined,
	muted: "muted",
	dim: "dim",
	thinking: "thinkingText",
	accent: "accent",
	success: "success",
	warning: "warning",
	error: "error",
};

export class RowGroupComponent implements Component {
	private readonly summary: () => RowGroupSummary;
	private readonly theme: Theme;
	private readonly onClick: () => void;
	private readonly segmentIndex: number;

	constructor(summary: () => RowGroupSummary, theme: Theme, onClick: () => void, segmentIndex: number) {
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
		const head = this.headText(line);
		const tail = this.tailText(line);

		if (!tail) {
			return truncateToWidth(head, width, ELLIPSIS);
		}

		const separator = line.hint ? HINT_SEPARATOR : SPACE;
		const headWidth = Math.max(MIN_HEAD_WIDTH, width - visibleWidth(tail) - separator.length);
		const fittedHead = truncateToWidth(head, headWidth, ELLIPSIS);

		return `${fittedHead}${separator}${tail}`;
	}

	private headText(line: RowLine): string {
		const indent = line.indent ? this.theme.fg("dim", line.indent) : BLANK;
		const mark = line.mark ? this.markText(line.mark) : BLANK;

		return `${indent}${mark}${this.bodyText(line)}`;
	}

	private bodyText(line: RowLine): string {
		if (line.spans) {
			return line.spans.map((span) => this.renderSpan(span)).join(BLANK);
		}

		if (line.isWarning) {
			return this.theme.fg("warning", line.text);
		}

		return line.isDim ? this.theme.fg("dim", line.text) : line.text;
	}

	private renderSpan(span: RowSpan): string {
		const color = COLOR_BY_TONE[span.tone];
		const colored = color ? this.theme.fg(color, span.text) : span.text;
		const withWeight = span.bold && this.theme.bold ? this.theme.bold(colored) : colored;

		return span.italic && this.theme.italic ? this.theme.italic(withWeight) : withWeight;
	}

	private tailText(line: RowLine): string {
		const hint = line.hint ? this.theme.fg("dim", line.hint) : BLANK;
		const duration = line.duration ? this.theme.fg("muted", line.duration) : BLANK;

		if (hint && duration) {
			return `${hint}${SPACE}${duration}`;
		}

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

	if (status === ToolStatus.Ok) {
		return "success";
	}

	if (status === ToolStatus.Blocked) {
		return "warning";
	}

	return "error";
}
