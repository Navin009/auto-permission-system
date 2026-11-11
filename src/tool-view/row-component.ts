import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { buildRowText, type RowDescription } from "../core/tool-view/row-text.ts";
import { StatusMark } from "../core/tool-view/status.ts";

const GUTTER_LENGTH = 1;
const ELLIPSIS = "…";

export class ToolRowComponent implements Component {
	private readonly description: RowDescription;
	private readonly theme: Theme;

	constructor(description: RowDescription, theme: Theme) {
		this.description = description;
		this.theme = theme;
	}

	render(width: number): string[] {
		const text = buildRowText(this.description);
		const isRunning = this.description.status === StatusMark.Running;
		const gutter = text.lead.slice(0, GUTTER_LENGTH);
		const leadBody = text.lead.slice(GUTTER_LENGTH);
		const coloredLead = `${this.colorGutter(gutter, isRunning)}${leadBody}`;
		const statusPart = isRunning ? "" : ` ${this.colorStatus(text.status)}`;
		const hintPart = text.hint ? ` ${this.theme.fg("dim", text.hint)}` : "";
		const lines = [truncateToWidth(`${coloredLead}${statusPart}${hintPart}`, width, ELLIPSIS)];

		if (text.commandLine) {
			lines.push(truncateToWidth(this.theme.fg("dim", text.commandLine), width, ELLIPSIS));
		}

		return lines;
	}

	invalidate(): void {}

	private colorGutter(gutter: string, isRunning: boolean): string {
		return this.theme.fg(isRunning ? "accent" : "muted", gutter);
	}

	private colorStatus(status: StatusMark): string {
		return this.theme.fg(status === StatusMark.Ok ? "success" : "error", status);
	}
}
