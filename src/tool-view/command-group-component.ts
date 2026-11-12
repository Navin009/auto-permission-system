import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import {
	commandGroupText,
	commandLinePrefix,
	type CommandGroupSummary,
	type CommandGroupText,
	type CommandLine,
} from "../core/tool-view/command-group.ts";
import { StatusMark } from "../core/tool-view/status.ts";

const MARK_SEPARATOR = " ";
const ELLIPSIS = "…";
const HINT_SEPARATOR = " ";

type MarkColor = Parameters<Theme["fg"]>[0];

export class CommandGroupComponent implements Component {
	private readonly summary: () => CommandGroupSummary;
	private readonly theme: Theme;

	constructor(summary: () => CommandGroupSummary, theme: Theme) {
		this.summary = summary;
		this.theme = theme;
	}

	render(width: number): string[] {
		const text = commandGroupText(this.summary());
		const lines = [this.headerLine(text)];

		if (text.overflowLine) {
			lines.push(this.theme.fg("dim", text.overflowLine));
		}

		for (const line of text.commandLines) {
			lines.push(this.commandLine(line));
		}

		return lines.map((line) => truncateToWidth(line, width, ELLIPSIS));
	}

	invalidate(): void {}

	private headerLine(text: CommandGroupText): string {
		const markPart = `${this.colorMark(text.mark, text.status)}${MARK_SEPARATOR}`;
		const hintPart = text.hint ? `${HINT_SEPARATOR}${this.theme.fg("dim", text.hint)}` : "";

		return `${markPart}${text.body}${hintPart}`;
	}

	private commandLine(line: CommandLine): string {
		const prefix = this.theme.fg("dim", commandLinePrefix());
		const markPart = line.mark ? `${this.colorMark(line.mark, line.status)}${MARK_SEPARATOR}` : "";

		return `${prefix}${markPart}${this.theme.fg("dim", line.text)}`;
	}

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
