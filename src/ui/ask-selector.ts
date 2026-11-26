import { Container, SelectList, Spacer, Text, type Component, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	FIELD_COLUMN_WIDTH,
	fieldToneOf,
	normalizeAskOption,
	type AskOptionItem,
	type FieldTone,
	type PromptField,
	type PromptFinding,
	type PromptOption,
} from "./prompt-spec.ts";

export type AskTheme = {
	fg(color: string, text: string): string;
	bold(text: string): string;
};

const BORDER_ROWS = 2;
const SPACER_ROWS = 6;
const HEADER_ROWS = 1;
const HELP_ROWS = 1;
const FOOTER_ROWS = 1;
const QUESTION_ROWS = 1;
const NOTE_ROWS = 1;
const CHROME_ROWS = BORDER_ROWS + SPACER_ROWS + HEADER_ROWS + HELP_ROWS;

const SCROLL_INDICATOR_ROWS = 1;
const HEADROOM_ROWS = 1;
const BODY_RESERVED_ROWS = SCROLL_INDICATOR_ROWS + HEADROOM_ROWS;

const HELP_KEYS = "↑↓ navigate   Enter select   Esc cancel";
const HELP_KEYS_WITH_SHORTCUTS = "↑↓/1-9 navigate   Enter select   Esc cancel";
const HELP_KEYS_SCROLL_SUFFIX = "   PgUp/PgDn scroll";
const FINDING_LINE_PATTERN = /^(Finding(?:\s+\d+)?:\s*)(.*)$/;
const METADATA_LINE_PATTERN = /^([A-Za-z][A-Za-z ]{1,12}\s{2,})(.+)$/;

const SCROLL_UP_KEYS = new Set(["\x1b[5~", "[", "\x1b[1;2A"]);
const SCROLL_DOWN_KEYS = new Set(["\x1b[6~", "]", "\x1b[1;2B"]);
const MAX_NUMERIC_SHORTCUTS = 9;

type BodyEntry =
	| { kind: "field"; labelColumn: string; value: string; tone: FieldTone }
	| { kind: "finding"; prefix: string; text: string }
	| { kind: "raw"; text: string };

function trimBlankEdges(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;

	while (start < end && lines[start].trim() === "") start++;
	while (end > start && lines[end - 1].trim() === "") end--;

	return lines.slice(start, end);
}

export type AskSelectorOptions = {
	title: string;
	fields?: readonly PromptField[];
	findings?: readonly PromptFinding[];

	footer: string | null;
	options: readonly PromptOption[];

	question?: string | null;

	note?: string | null;

	timeoutMs: number;
	tui: { requestRender(): void; terminal?: { rows: number; columns: number } };
	theme: AskTheme;
	keybindings: { matches(data: string, action: string): boolean };

	done: (result: string | undefined) => void;

	onExpire: () => void;

	tickMs?: number;

	maxBodyLines?: number;
};

class Border implements Component {
	private readonly color: (text: string) => string;
	constructor(color: (text: string) => string) {
		this.color = color;
	}
	invalidate(): void {}
	render(width: number): string[] {
		return [this.color("─".repeat(Math.max(1, width)))];
	}
}

export class AskSelector extends Container {
	private readonly theme: AskTheme;
	private readonly tui: { requestRender(): void; terminal?: { rows: number; columns: number } };
	private readonly keybindings: { matches(data: string, action: string): boolean };
	private readonly done: (result: string | undefined) => void;
	private readonly onExpire: () => void;
	private readonly timeoutMs: number;
	private readonly tickMs: number;
	private readonly footerBase: string | null;
	private readonly footerText: Text | null = null;
	private readonly list: SelectList;
	private readonly items: AskOptionItem[];
	private readonly hasShortcuts: boolean;
	private selected = 0;
	private footerVisible: boolean;
	private remaining: number;
	private timer: ReturnType<typeof setInterval> | null = null;
	private finished = false;
	private engaged = false;

	private readonly isMultiLine: boolean;
	private readonly headerText: string;
	private readonly bodyEntries: BodyEntry[];
	private readonly maxBodyLines: number;
	private readonly bodyComponent: Text | null = null;
	private readonly indicatorComponent: Text | null = null;
	private readonly helpComponent: Text;

	private readonly extraChromeRows: number;
	private bodyScrollOffset = 0;
	private wrappedRows: string[] = [];
	private wrappedRowsWidth = -1;
	private bodyViewportRows = 0;
	private scrollable = false;

	constructor(o: AskSelectorOptions) {
		super();
		this.theme = o.theme;
		this.tui = o.tui;
		this.keybindings = o.keybindings;
		this.done = o.done;
		this.onExpire = o.onExpire;
		this.timeoutMs = o.timeoutMs;
		this.tickMs = o.tickMs ?? 1000;
		this.footerBase = o.footer;
		this.items = o.options.map(normalizeAskOption);
		this.hasShortcuts = this.items.some((item) => Boolean(item.key));
		this.footerVisible = o.footer !== null && o.footer !== "";
		this.remaining = Math.ceil(o.timeoutMs / 1000);
		this.maxBodyLines = o.maxBodyLines ?? 12;
		this.extraChromeRows = (o.question ? QUESTION_ROWS : 0) + (o.note ? NOTE_ROWS : 0);

		const allLines = o.title.split("\n");
		const hasStructuredBody = Boolean(o.fields?.length || o.findings?.length);

		this.headerText = hasStructuredBody ? (allLines[0] ?? o.title) : (allLines[0] ?? "");
		this.bodyEntries = hasStructuredBody
			? this.entriesFromSpec(o.fields ?? [], o.findings ?? [])
			: this.entriesFromLines(trimBlankEdges(allLines.slice(1)));
		this.isMultiLine = this.bodyEntries.length > 0;

		this.addChild(new Border((t) => this.theme.fg("border", t)));
		this.addChild(new Spacer(1));
		this.addChild(new Text(this.theme.fg("accent", this.theme.bold(this.headerText)), 0, 0));

		if (this.isMultiLine) {
			this.addChild(new Spacer(1));
			this.bodyComponent = new Text("", 0, 0);
			this.addChild(this.bodyComponent);
			this.indicatorComponent = new Text("", 0, 0);
			this.addChild(this.indicatorComponent);
		}

		this.addChild(new Spacer(1));

		if (o.question) this.addChild(new Text(this.theme.fg("accent", this.theme.bold(o.question)), 0, 0));
		if (o.note) this.addChild(new Text(this.theme.fg("muted", o.note), 0, 0));

		if (this.footerVisible) {
			this.footerText = new Text(this.footerValue(), 0, 0);
			this.addChild(this.footerText);
		}

		this.addChild(new Spacer(1));
		this.list = this.createSelectList();
		this.addChild(this.list);

		this.addChild(new Spacer(1));
		this.helpComponent = new Text(this.helpText(), 0, 0);
		this.addChild(this.helpComponent);
		this.addChild(new Spacer(1));
		this.addChild(new Border((t) => this.theme.fg("border", t)));

		if (this.timeoutMs > 0) this.startCountdown();

		this.layoutBody(this.tui.terminal?.columns ?? 80);
	}

	private createSelectList(): SelectList {
		const list = new SelectList(
			this.items.map((item) => ({
				value: item.value,
				label: item.key ? `[${item.key}] ${item.label}` : item.label,
				description: item.description,
			})),
			Math.max(1, this.items.length),
			{
				selectedPrefix: (t) => this.theme.fg("accent", t),
				selectedText: (t) => this.theme.fg("accent", t),
				description: (t) => this.theme.fg("muted", t),
				scrollInfo: (t) => this.theme.fg("muted", t),
				noMatch: (t) => this.theme.fg("muted", t),
			},
		);
		list.onSelectionChange = (item) => {
			const index = this.items.findIndex((candidate) => candidate.value === item.value);
			if (index !== -1 && index !== this.selected) {
				this.selected = index;
				this.onActivity();
			}
		};
		list.onSelect = (item) => this.finish(item.value);
		list.onCancel = () => this.finish(undefined);

		return list;
	}

	render(width: number): string[] {
		this.layoutBody(width);
		return super.render(width);
	}

	handleInput(data: string): void {
		if (this.scrollable) {
			const pageSize = Math.max(1, this.bodyViewportRows - 1);
			if (this.keybindings.matches(data, "tui.select.pageUp") || SCROLL_UP_KEYS.has(data)) {
				this.scrollBody(-pageSize);
				return;
			}
			if (this.keybindings.matches(data, "tui.select.pageDown") || SCROLL_DOWN_KEYS.has(data)) {
				this.scrollBody(pageSize);
				return;
			}
		}
		if (this.keybindings.matches(data, "tui.select.up")) {
			this.move(-1);
			return;
		}
		if (this.keybindings.matches(data, "tui.select.down")) {
			this.move(1);
			return;
		}
		const shortcutMatch = this.matchShortcut(data);
		if (shortcutMatch !== undefined) {
			this.finish(shortcutMatch);
			return;
		}
		this.list.handleInput(data);
	}

	private matchShortcut(data: string): string | undefined {
		if (data.length !== 1) return undefined;

		if (this.hasShortcuts) {
			const lower = data.toLowerCase();
			const keyed = this.items.find((item) => item.key?.toLowerCase() === lower);
			if (keyed) return keyed.value;

			const digit = Number(data);
			if (Number.isInteger(digit) && digit >= 1 && digit <= Math.min(MAX_NUMERIC_SHORTCUTS, this.items.length)) {
				return this.items[digit - 1]?.value;
			}
		}

		return undefined;
	}

	private entriesFromSpec(fields: readonly PromptField[], findings: readonly PromptFinding[]): BodyEntry[] {
		const columnWidth = fields.reduce((max, field) => Math.max(max, field.label.length + 2), FIELD_COLUMN_WIDTH);
		const entries: BodyEntry[] = fields.map((field) => ({
			kind: "field",
			labelColumn: field.label.padEnd(columnWidth),
			value: field.value,
			tone: field.tone ?? fieldToneOf(field.label),
		}));

		for (const finding of findings) {
			entries.push({ kind: "finding", prefix: finding.prefix, text: finding.text });
		}

		return entries;
	}

	private entriesFromLines(lines: readonly string[]): BodyEntry[] {
		return lines.map((line) => {
			const findingMatch = FINDING_LINE_PATTERN.exec(line);
			if (findingMatch) {
				return { kind: "finding", prefix: findingMatch[1], text: findingMatch[2] };
			}

			const metadataMatch = METADATA_LINE_PATTERN.exec(line);
			if (metadataMatch) {
				const [, labelColumn, value] = metadataMatch;
				return { kind: "field", labelColumn, value, tone: fieldToneOf(labelColumn.trim()) };
			}

			return { kind: "raw", text: line };
		});
	}

	private layoutBody(width: number): void {
		if (!this.bodyComponent) return;

		this.measureBody(width);
		this.bodyViewportRows = this.bodyBudget();
		this.scrollable = this.wrappedRows.length > this.bodyViewportRows;

		const maxOffset = Math.max(0, this.wrappedRows.length - this.bodyViewportRows);
		this.bodyScrollOffset = Math.max(0, Math.min(this.bodyScrollOffset, maxOffset));
		this.paintBody();
	}

	private measureBody(width: number): void {
		const contentWidth = Math.max(1, width);
		if (width === this.wrappedRowsWidth) return;

		const rows: string[] = [];

		for (const entry of this.bodyEntries) {
			const styled = this.formatEntry(entry).replaceAll("\t", "   ");

			for (const row of wrapTextWithAnsi(styled, contentWidth)) rows.push(row);
		}

		this.wrappedRows = rows;
		this.wrappedRowsWidth = width;
	}

	private formatEntry(entry: BodyEntry): string {
		if (entry.kind === "finding") {
			return `${this.theme.fg("warning", this.theme.bold(entry.prefix))}${entry.text}`;
		}

		if (entry.kind === "field") {
			return `${this.theme.fg("muted", entry.labelColumn)}${this.formatFieldValue(entry.tone, entry.value)}`;
		}

		return entry.text;
	}

	private formatFieldValue(tone: FieldTone, value: string): string {
		if (tone === "warning") return this.theme.fg("warning", value);
		if (tone === "dim") return this.theme.fg("dim", value);
		if (tone === "muted") return this.theme.fg("muted", value);
		return value;
	}

	private bodyBudget(): number {
		const rows = this.tui.terminal?.rows;
		if (!rows || rows <= 0) return this.maxBodyLines;

		const fixedRows = this.footerVisible ? FOOTER_ROWS : 0;
		const chrome = CHROME_ROWS + fixedRows + this.extraChromeRows + this.items.length;
		const available = rows - chrome - BODY_RESERVED_ROWS;

		return Math.max(1, Math.min(this.maxBodyLines, available));
	}

	private paintBody(): void {
		const total = this.wrappedRows.length;
		const sliceEnd = this.bodyScrollOffset + this.bodyViewportRows;
		const slice = this.wrappedRows.slice(this.bodyScrollOffset, sliceEnd);

		this.bodyComponent?.setText(slice.join("\n"));
		this.indicatorComponent?.setText(this.scrollable ? this.renderScrollIndicator(total) : "");
		this.helpComponent.setText(this.helpText());
	}

	private helpText(): string {
		const base = this.hasShortcuts ? HELP_KEYS_WITH_SHORTCUTS : HELP_KEYS;
		const keys = this.scrollable ? `${base}${HELP_KEYS_SCROLL_SUFFIX}` : base;

		return this.theme.fg("muted", keys);
	}

	private renderScrollIndicator(total: number): string {
		const start = this.bodyScrollOffset + 1;
		const end = Math.min(total, this.bodyScrollOffset + this.bodyViewportRows);

		return this.theme.fg("muted", `[${start}–${end}/${total}]`);
	}

	private scrollBody(delta: number): void {
		if (!this.scrollable) return;

		const maxOffset = Math.max(0, this.wrappedRows.length - this.bodyViewportRows);
		const next = Math.max(0, Math.min(maxOffset, this.bodyScrollOffset + delta));
		if (next === this.bodyScrollOffset) return;

		this.bodyScrollOffset = next;
		this.paintBody();
		this.onActivity();
		this.tui.requestRender();
	}

	handleMouse(event: { type?: string; wheelDelta?: number }): undefined {
		if (event?.type === "wheel" && Number.isFinite(event.wheelDelta) && this.scrollable) {
			const delta = event.wheelDelta;
			if (delta !== undefined) this.scrollBody(delta > 0 ? 2 : -2);
		}

		return undefined;
	}

	private move(delta: number): void {
		const next = Math.max(0, Math.min(this.items.length - 1, this.selected + delta));
		if (next === this.selected) return;
		this.selected = next;
		this.list.setSelectedIndex(next);
		this.onActivity();
	}

	dispose(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.finish(undefined);
	}

	private footerValue(): string {
		const text =
			this.timeoutMs > 0 && this.footerBase ? `${this.footerBase} (${this.remaining}s)` : (this.footerBase ?? "");
		return this.theme.fg("warning", this.theme.bold(text));
	}

	private startCountdown(): void {
		this.refreshFooter();
		this.timer = setInterval(() => {
			this.remaining -= 1;
			if (this.remaining <= 0) {
				this.expire();
				return;
			}
			this.refreshFooter();
			this.tui.requestRender();
		}, this.tickMs);
	}

	private onActivity(): void {
		this.engaged = true;
		if (this.footerVisible) this.hideFooter();
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	private hideFooter(): void {
		this.footerVisible = false;
		if (this.footerText) this.removeChild(this.footerText);

		this.tui.requestRender();
	}

	private refreshFooter(): void {
		this.footerText?.setText(this.footerValue());
	}

	private expire(): void {
		if (this.finished || this.engaged) return;
		this.onExpire();
		this.finish(undefined);
	}

	private finish(result: string | undefined): void {
		if (this.finished) return;
		this.finished = true;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.done(result);
	}
}
