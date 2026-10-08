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
 *     Yes, all in group for this session
 *     Yes, always…
 *
 * `askSelect` loads this module lazily and only in TUI mode
 * (`ctx.mode === "tui"`), so `src/ui/ask-flow.ts` and the contract tests stay
 * free of pi-tui imports. RPC keeps `ui.select`: RPC's `ui.custom` is a no-op
 * that resolves `undefined` immediately, which would silently deny.
 */

import { Container, SelectList, Spacer, Text, type Component } from "@earendil-works/pi-tui";

export type AskTheme = {
	fg(color: string, text: string): string;
	bold(text: string): string;
};

export type AskSelectorOptions = {
	/** Header + body lines; the footer is passed separately so it can be hidden. */
	title: string;
	/** The `Default: …` line, or null when the prompt has no default hint. */
	footer: string | null;
	options: string[];
	/** 0 disables the countdown (the prompt stays open until pick/Esc). */
	timeoutMs: number;
	tui: { requestRender(): void };
	theme: AskTheme;
	keybindings: { matches(data: string, action: string): boolean };
	/** Resolves the `ctx.ui.custom` promise; `undefined` means Esc/expiry. */
	done: (result: string | undefined) => void;
	/** Called when the countdown runs out, before `done(undefined)` — lets the
	 * caller tell an unanswered prompt from an Esc (ADR-024). */
	onExpire: () => void;
	/** Countdown tick, default 1000 ms. Test seam. */
	tickMs?: number;
};

/** A one-line horizontal rule, like pi's DynamicBorder but without the
 * internal import (`@earendil-works/pi-tui` does not export it). */
class Border implements Component {
	private readonly color: (text: string) => string;
	constructor(color: (text: string) => string) {
		this.color = color;
	}
	invalidate(): void {
		/* stateless */
	}
	render(width: number): string[] {
		return [this.color("─".repeat(Math.max(1, width)))];
	}
}

export class AskSelector extends Container {
	private readonly theme: AskTheme;
	private readonly tui: { requestRender(): void };
	private readonly keybindings: { matches(data: string, action: string): boolean };
	private readonly done: (result: string | undefined) => void;
	private readonly onExpire: () => void;
	private readonly timeoutMs: number;
	private readonly tickMs: number;
	private readonly footerBase: string | null;
	private readonly footerText: Text | null = null;
	private readonly footerSpacer: Spacer | null = null;
	private readonly list: SelectList;
	private readonly labels: string[];
	private selected = 0;
	private footerVisible: boolean;
	private remaining: number;
	private timer: ReturnType<typeof setInterval> | null = null;
	private finished = false;

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

		this.addChild(new Border((t) => this.theme.fg("border", t)));
		this.addChild(new Spacer(1));
		this.addChild(new Text(this.theme.fg("accent", this.theme.bold(o.title)), 0, 0));
		this.addChild(new Spacer(1));
		if (this.footerVisible) {
			this.footerText = new Text(this.footerValue(), 0, 0);
			this.addChild(this.footerText);
			this.footerSpacer = new Spacer(1);
			this.addChild(this.footerSpacer);
		}

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
		this.addChild(new Text(this.theme.fg("muted", "↑↓ navigate   Enter select   Esc cancel"), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Border((t) => this.theme.fg("border", t)));

		if (this.timeoutMs > 0) this.startCountdown();
	}

	handleInput(data: string): void {
		// Intercept ↑/↓: pi's SelectList wraps at the ends, the ask prompts have
		// always clamped. Everything else (Enter, Esc, page keys, mouse) is the
		// list's own behavior.
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

	/** Activity restarts the countdown, so reading the options never runs it out
	 * (v3.5.3 behavior); the footer only ever disappears, it never comes back. */
	private onActivity(): void {
		if (this.footerVisible) this.hideFooter();
		if (this.timeoutMs > 0) {
			if (this.timer) clearInterval(this.timer);
			this.timer = null;
			this.startCountdown();
		}
	}

	private hideFooter(): void {
		this.footerVisible = false;
		if (this.footerText) this.removeChild(this.footerText);
		if (this.footerSpacer) this.removeChild(this.footerSpacer);
		this.tui.requestRender();
	}

	private refreshFooter(): void {
		this.footerText?.setText(this.footerValue());
	}

	private expire(): void {
		if (this.finished) return;
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
