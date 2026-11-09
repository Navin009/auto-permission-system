/**
 * TUI ask selector (ADR-031). pi's `ui.select` can render a multi-line title
 * and a countdown, but it cannot do both at once *and* drop the "Default:"
 * line once the user starts choosing. This component can:
 *
 *   🌐  Let composio connect to us.i.posthog.com?
 *   Site     us.i.posthog.com
 *   Group    *.posthog.com   (every posthog.com site)
 *   Command  composio search "get google ads account" ...
 *   Why      this site isn't on your allowed list yet
 *
 *   Default: Yes, just this once (15s)      ← live; hidden on the first ↑/↓
 *
 *   → No
 *     Yes, just this once
 *     Yes, all in group for this conversation
 *     Yes, always…
 *
 * Keyboard only (ADR-036): ↑/↓ move the highlight, Enter selects, Esc cancels.
 * The countdown only applies to an untouched prompt: the first ↑/↓ cancels it, so
 * a user who is choosing is never auto-answered and Enter/Esc alone decide
 * (ADR-039). Mouse events are swallowed before they reach the list — pi's
 * SelectList picks the clicked row and moves the highlight on wheel, which
 * could approve a row the user never read. The wheel scrolls the body only.
 *
 * The body is a viewport measured in wrapped rows and sized to the terminal
 * (ADR-041).
 *
 * `askSelect` loads this module lazily and only in TUI mode
 * (`ctx.mode === "tui"`), so `src/ui/ask-flow.ts` and the contract tests stay
 * free of pi-tui imports. RPC keeps `ui.select`: RPC's `ui.custom` is a no-op
 * that resolves `undefined` immediately, which would silently deny.
 */

import { Container, SelectList, Spacer, Text, type Component, wrapTextWithAnsi } from "@earendil-works/pi-tui";

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
const HELP_KEYS_WITH_SCROLL = "↑↓ navigate   Enter select   Esc cancel   PgUp/PgDn scroll";

function trimBlankEdges(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;

	while (start < end && lines[start].trim() === "") start++;
	while (end > start && lines[end - 1].trim() === "") end--;

	return lines.slice(start, end);
}

export type AskSelectorOptions = {
	/** Header + body lines; the footer is passed separately so it can be hidden. */
	title: string;
	/** The `Default: …` line, or null when the prompt has no default hint. */
	footer: string | null;
	options: string[];
	/** The question above the choices. Fixed: it never scrolls with the body. */
	question?: string | null;
	/** One muted line under the question, also fixed. */
	note?: string | null;
	/** 0 disables the countdown (the prompt stays open until pick/Esc). */
	timeoutMs: number;
	tui: { requestRender(): void; terminal?: { rows: number; columns: number } };
	theme: AskTheme;
	keybindings: { matches(data: string, action: string): boolean };
	/** Resolves the `ctx.ui.custom` promise; `undefined` means Esc/expiry. */
	done: (result: string | undefined) => void;
	/** Called when the countdown runs out, before `done(undefined)` — lets the
	 * caller tell an unanswered prompt from an Esc (ADR-024). */
	onExpire: () => void;
	/** Countdown tick, default 1000 ms. Test seam. */
	tickMs?: number;
	/** Maximum body lines shown in viewport before scrolling engages. Default 12. */
	maxBodyLines?: number;
};

/** A one-line horizontal rule, like pi's DynamicBorder but without the
 * internal import (`@earendil-works/pi-tui` does not export it). */
class Border implements Component {
	private readonly color: (text: string) => string;
	constructor(color: (text: string) => string) {
		this.color = color;
	}
	invalidate(): void {
	}
	render(width: number): string[] {
		return [this.color("─".repeat(Math.max(1, width)))];
	}
}

const SCROLL_UP_KEYS = new Set(["\x1b[5~", "[", "\x1b[1;2A"]);
const SCROLL_DOWN_KEYS = new Set(["\x1b[6~", "]", "\x1b[1;2B"]);

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
	private readonly labels: string[];
	private selected = 0;
	private footerVisible: boolean;
	private remaining: number;
	private timer: ReturnType<typeof setInterval> | null = null;
	private finished = false;
	private engaged = false;

	private readonly isMultiLine: boolean;
	private readonly headerText: string;
	private readonly bodyLines: string[];
	private readonly maxBodyLines: number;
	private readonly bodyComponent: Text | null = null;
	private readonly indicatorComponent: Text | null = null;
	private readonly helpComponent: Text;
	/** Rows the fixed question and note take, when the prompt has them. */
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
		this.labels = o.options;
		this.footerVisible = o.footer !== null && o.footer !== "";
		this.remaining = Math.ceil(o.timeoutMs / 1000);
		this.maxBodyLines = o.maxBodyLines ?? 12;
		this.extraChromeRows = (o.question ? QUESTION_ROWS : 0) + (o.note ? NOTE_ROWS : 0);

		const allLines = o.title.split("\n");
		this.isMultiLine = allLines.length > 1;

		if (this.isMultiLine) {
			this.headerText = allLines[0] ?? "";
			this.bodyLines = trimBlankEdges(allLines.slice(1));
		} else {
			this.headerText = o.title;
			this.bodyLines = [];
		}

		this.addChild(new Border((t) => this.theme.fg("border", t)));
		this.addChild(new Spacer(1));

		if (this.isMultiLine) {
			this.addChild(new Text(this.theme.fg("accent", this.theme.bold(this.headerText)), 0, 0));
			this.addChild(new Spacer(1));
			this.bodyComponent = new Text("", 0, 0);
			this.addChild(this.bodyComponent);
			this.indicatorComponent = new Text("", 0, 0);
			this.addChild(this.indicatorComponent);
		} else {
			this.addChild(new Text(this.theme.fg("accent", this.theme.bold(o.title)), 0, 0));
		}

		this.addChild(new Spacer(1));

		if (o.question) this.addChild(new Text(this.theme.fg("accent", this.theme.bold(o.question)), 0, 0));
		if (o.note) this.addChild(new Text(this.theme.fg("muted", o.note), 0, 0));

		if (this.footerVisible) {
			this.footerText = new Text(this.footerValue(), 0, 0);
			this.addChild(this.footerText);
		}

		this.addChild(new Spacer(1));

		this.list = new SelectList(
			o.options.map((label) => ({ value: label, label })),
			Math.max(1, o.options.length),
			{
				selectedPrefix: (t) => this.theme.fg("accent", t),
				selectedText: (t) => this.theme.fg("accent", t),
				description: (t) => this.theme.fg("muted", t),
				scrollInfo: (t) => this.theme.fg("muted", t),
				noMatch: (t) => this.theme.fg("muted", t),
			},
		);
		this.list.onSelectionChange = (item) => {
			const index = this.labels.indexOf(item.value);
			if (index !== -1 && index !== this.selected) {
				this.selected = index;
				this.onActivity();
			}
		};
		this.list.onSelect = (item) => this.finish(item.value);
		this.list.onCancel = () => this.finish(undefined);
		this.addChild(this.list);

		this.addChild(new Spacer(1));
		this.helpComponent = new Text(this.helpText(), 0, 0);
		this.addChild(this.helpComponent);
		this.addChild(new Spacer(1));
		this.addChild(new Border((t) => this.theme.fg("border", t)));

		if (this.timeoutMs > 0) this.startCountdown();

		this.layoutBody(this.tui.terminal?.columns ?? 80);
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
		this.list.handleInput(data);
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

		for (const line of this.bodyLines) {
			const normalizedLine = line.replaceAll("\t", "   ");
			const styled = this.theme.fg("accent", this.theme.bold(normalizedLine));

			for (const row of wrapTextWithAnsi(styled, contentWidth)) rows.push(row);
		}

		this.wrappedRows = rows;
		this.wrappedRowsWidth = width;
	}

	private bodyBudget(): number {
		const rows = this.tui.terminal?.rows;
		if (!rows || rows <= 0) return this.maxBodyLines;

		const fixedRows = this.footerVisible ? FOOTER_ROWS : 0;
		const chrome = CHROME_ROWS + fixedRows + this.extraChromeRows + this.labels.length;
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
		const keys = this.scrollable ? HELP_KEYS_WITH_SCROLL : HELP_KEYS;

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
		const next = Math.max(0, Math.min(this.labels.length - 1, this.selected + delta));
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

	/** The `Default: …` line, with the live `(Ns)` suffix while counting down. */
	private footerValue(): string {
		const text = this.timeoutMs > 0 && this.footerBase ? `${this.footerBase} (${this.remaining}s)` : this.footerBase ?? "";
		return this.theme.fg("accent", this.theme.bold(text));
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

	/** The first ↑/↓ ends the countdown: a user who has started choosing decides
	 * with Enter/Esc, not a timer (ADR-039). The footer is gone, so nothing is
	 * left that claims to be counting down. */
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
