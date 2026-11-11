import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { buildRowText, type RowDescription } from "../core/tool-view/row-text.ts";
import { StatusMark } from "../core/tool-view/status.ts";

const MARK_SEPARATOR = " ";
const ELLIPSIS = "…";

type MarkColor = Parameters<Theme["fg"]>[0];

export class ToolRowComponent implements Component {
	private readonly description: RowDescription;
	private readonly theme: Theme;

	constructor(description: RowDescription, theme: Theme) {
		this.description = description;
		this.theme = theme;
	}

	render(width: number): string[] {
		const text = buildRowText(this.description);
		const markPart = `${this.colorMark(text.mark, text.status)}${MARK_SEPARATOR}`;
		const hintPart = text.hint ? ` ${this.theme.fg("dim", text.hint)}` : "";
		const lines = [truncateToWidth(`${markPart}${text.body}${hintPart}`, width, ELLIPSIS)];

		if (text.commandLine) {
			lines.push(truncateToWidth(this.theme.fg("dim", text.commandLine), width, ELLIPSIS));
		}

		return lines;
	}

	invalidate(): void {}

	private colorMark(mark: string, status: StatusMark): string {
		return this.theme.fg(colorForStatus(status), mark);
	}
}

function colorForStatus(status: StatusMark): MarkColor {
	if (status === StatusMark.Running) {
		return "accent";
	}

	if (status === StatusMark.Ok) {
		return "success";
	}

	return "error";
}
