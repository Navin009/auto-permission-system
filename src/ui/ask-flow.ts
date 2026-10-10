/**
 * Shared ask-tier UI primitives for both layers. Pure: no pi, no OS, no fs —
 * it only calls the caller's `ctx.ui.select`, so the contract tests can script it.
 *
 * Every prompt is a question. Answers are uniformly `No` / `Yes, just this once` /
 * `Yes, for this session` / `Yes, always…` so row 2 is always "once". Screen 2
 * collapses to "All in folder · in this project" / "Only <name> · in this project" /
 * "All in folder · in all projects" / "Only <name> · in all projects" — folder /
 * wildcard is preselected (the wider grant is the right answer almost every time).
 * Every screen ends with a footer that says plainly what Esc and no answer do
 * (ADR-024: network default is allow once).
 *
 * Every select is serialized: a second overlapping `ui.select` replaces the
 * first on screen, and the first one's countdown later disposes the newer
 * selector, whose promise never settles (ADR-024).
 */

import { GrantScope } from "../core/index";

/** Structural view of a pi-tui component (`ctx.ui.custom` result) — enough for
 * the ask selector. `render` must return lines that fit the given width. */
export type AskComponent = {
	render(width: number): string[];
	handleInput?(data: string): void;
	invalidate?(): void;
	dispose?(): void;
};

/** The slice of pi's theme the selector styles with. */
export type AskTheme = {
	fg(color: string, text: string): string;
	bold(text: string): string;
};

/** The slice of pi's KeybindingsManager the selector's list delegates to. */
export type AskKeybindings = {
	matches(data: string, action: string): boolean;
};

/** The slice of pi's TUI the selector needs (countdown repaint). */
export type AskTui = {
	requestRender(): void;
};

export type AskCustomUi = (
	factory: (tui: AskTui, theme: AskTheme, keybindings: AskKeybindings, done: (result: string | undefined) => void) => AskComponent,
) => Promise<string | undefined>;

export type AskCtx = {
	hasUI?: boolean;
	/** pi's run mode. The custom selector is TUI-only: RPC's `ui.custom` is a
	 * no-op that resolves `undefined` immediately, so RPC keeps `ui.select`. */
	mode?: string;
	ui: {
		select: (t: string, o: string[], op?: { timeout?: number; signal?: AbortSignal }) => Promise<string | undefined>;
		/** TUI-only custom component host. Absent in tests and RPC. */
		custom?: AskCustomUi;
		/** Optional — only present in interactive TUI mode. Tests/scripts use a stub. */
		onTerminalInput?: (handler: (data: string) => void) => () => void;
	};
};

export const MainChoice = {
	Block: "block",
	Once: "once",
	Session: "session",
	Remember: "remember",
} as const;
export type MainChoice = (typeof MainChoice)[keyof typeof MainChoice];

/** How long a pending permission prompt waits before it resolves to its default.
 * ADR-030: per-action overrides below — the user picks a wider scope (folder / wildcard) and
 * needs more time on screen 2 than on the fast yes/no of screen 1. */
export const ASK_TIMEOUT_MS = 15_000;

/** Per-action overrides; `0` means no countdown (the prompt stays open until Esc/select). */
export const ASK_TIMEOUT_BY_ACTION: Record<"read" | "write" | "network" | "remember", number> = {
	read:     15_000,
	write:    15_000,
	network:  30_000,
	remember: 60_000,
};

/** Icons per prompt type. Header takes the icon + title. */
export const ICON = {
	ask: "❓",          // normal ask — every prompt is a question
	warn: "⚠",          // system change (sudo, untrusted project, /etc writes)
	cred: "🔑",         // secrets and credentials (askRead, denyRead, advanced-secure)
	net: "🌐",          // network (allowFirst)
	save: "💾",         // screen 2 — always-remember scope pick
} as const;
export type IconKey = keyof typeof ICON;

/**
 * The tail of the FIFO prompt queue. pi's selector is a singleton: when a
 * second `ui.select` arrives it replaces the first on screen, and the first
 * one's countdown later disposes the second without ever resolving its
 * promise. The sandbox network proxy awaits that promise before deciding a
 * connection, so the bash command would hang until its own timeout. One
 * prompt at a time is the only way to avoid the race from this side.
 *
 * Kept on `globalThis`: pi loads each extension with its own jiti module
 * cache (`moduleCache: false`), so Layer 1 and Layer 2 do not share this
 * module's state — but they do share pi's one selector.
 */
const ASK_CHAIN_GLOBAL = "__autoPermissionSystemAskChain__";
type AskChainGlobal = typeof globalThis & { [ASK_CHAIN_GLOBAL]?: Promise<unknown> };

function queueTail(): Promise<unknown> {
	const g = globalThis as AskChainGlobal;
	g[ASK_CHAIN_GLOBAL] ??= Promise.resolve();
	return g[ASK_CHAIN_GLOBAL];
}

/**
 * One serialized ask. `expired` separates the countdown running out from an
 * early Esc: both resolve `undefined`, only the countdown is the prompt's
 * default. Measured inside the lock, so time spent queued behind another
 * prompt never counts.
 *
 * Activity extension (v3.5.3): when the user presses ↑/↓/Tab/Home/End/PgUp/PgDn
 * while the prompt is open, the timeout is reset. They aren't being idle —
 * they're reading options and deciding. Setting `timeoutMs` to `0` disables
 * the countdown entirely (the prompt stays open until pick or Esc).
 *
 * v3.5.7: `skipQueue` runs the ask immediately, bypassing the FIFO queue.
 * The screen-2 helpers (askRememberFile/AskRememberHost) use this so
 * screen 2 always runs immediately after screen 1's pick — no other queued
 * prompt can interleave between them.
 *
 * v3.5.12 (ADR-031): in TUI mode the footer is rendered separately, with a
 * live countdown, and disappears on the first selection change. RPC and the
 * tests keep `ui.select` with the footer as the last title line.
 */
export async function askSelect(
	ctx: AskCtx,
	title: string,
	options: string[],
	timeoutMs: number = ASK_TIMEOUT_MS,
	opts: { skipQueue?: boolean; footer?: string | null } = {},
): Promise<{ picked: string | undefined; expired: boolean }> {
	const footer = opts.footer ?? null;
	const run = async (): Promise<{ picked: string | undefined; expired: boolean }> => {
		if (ctx.mode === "tui" && typeof ctx.ui.custom === "function") {
			return askWithCustom(ctx, title, options, timeoutMs, footer);
		}
		return askWithSelect(ctx, title, options, timeoutMs, footer);
	};
	if (opts.skipQueue) return run();
	const queued = queueTail().then(run, run);
	(globalThis as AskChainGlobal)[ASK_CHAIN_GLOBAL] = queued.then(() => undefined, () => undefined);
	return queued;
}

/**
 * TUI path (ADR-031): a custom component owns the countdown, so `expired` is
 * exact — Esc can never be mistaken for the countdown running out. Loaded
 * lazily: the pi-tui imports only exist in this branch.
 */
async function askWithCustom(
	ctx: AskCtx,
	title: string,
	options: string[],
	timeoutMs: number,
	footer: string | null,
): Promise<{ picked: string | undefined; expired: boolean }> {
	const { AskSelector } = await import("./ask-selector");
	let expired = false;
	const picked = await ctx.ui.custom!((tui, theme, keybindings, done) =>
		new AskSelector({
			title,
			footer,
			options,
			timeoutMs,
			tui,
			theme,
			keybindings,
			done,
			onExpire: () => {
				expired = true;
			},
		}),
	);
	return { picked, expired };
}

/** Select fallback (RPC, print, tests): the footer is the last title line and
 * expiry is inferred from elapsed time (ADR-024). */
async function askWithSelect(
	ctx: AskCtx,
	title: string,
	options: string[],
	timeoutMs: number,
	footer: string | null,
): Promise<{ picked: string | undefined; expired: boolean }> {
	const selectTitle = footer ? `${title}\n\n${footer}` : title;
	if (timeoutMs === 0) {
		const picked = await ctx.ui.select(selectTitle, options);
		return { picked, expired: false };
	}
	const started = Date.now();
	const picked = await askSelectWithActivity(ctx, selectTitle, options, timeoutMs);
	return { picked, expired: picked === undefined && Date.now() - started >= timeoutMs };
}

/**
 * `ui.select` with activity-based timer extension. v3.5.10: pi's "(Ns)" countdown
 * is NOT passed to `ctx.ui.select` (the v3.5.6 attempt with abort+reissue flickered
 * because pi's SelectList resets selectedIndex on every re-issue). The outer timer
 * is reset on navigation input (v3.5.3 behavior) so the user has more time while
 * reading options. `timeoutMs === 0` takes the no-countdown-no-auto-dismiss path
 * (prompt stays open until pick or Esc).
 */
async function askSelectWithActivity(
	ctx: AskCtx,
	title: string,
	options: string[],
	timeoutMs: number,
): Promise<string | undefined> {
	if (timeoutMs === 0) return ctx.ui.select(title, options);

	const offInput = ctx.ui.onTerminalInput?.((data: string) => {
		if (settled) return;
		if (data.includes("\x1b[") || data === "\t" || data === "\r" || data === "\n") {
			if (currentTimer) clearTimeout(currentTimer);
			currentTimer = setTimeout(finish, timeoutMs);
		}
	}) ?? (() => {});

	let settled = false;
	let currentTimer: ReturnType<typeof setTimeout> | null = null;
	const ctrl = new AbortController();

	const finish = (): undefined => {
		if (settled) return undefined;
		settled = true;
		if (currentTimer) clearTimeout(currentTimer);
		if (!ctrl.signal.aborted) ctrl.abort();
		offInput();
		return undefined;
	};

	currentTimer = setTimeout(finish, timeoutMs);

	const picked = await ctx.ui.select(title, options, { signal: ctrl.signal });
	if (settled) return undefined;
	settled = true;
	if (currentTimer) clearTimeout(currentTimer);
	offInput();
	return picked;
}

/** Join `header` + optional `icon` (e.g. `🔑  Let pi read your key?`). The icon gets a double space. */
function withIcon(icon: string | undefined, header: string): string {
	return icon ? `${icon}  ${header}` : header;
}

export type MainOpts = {
	/** Offer `Yes, just this once` (default on). */
	once?: boolean;
	/** Offer `Yes, for this session` (opt-in). */
	session?: boolean;
	/** Override the session label so the caller can name what the session grant covers
	 * (`Yes, for this session` for files, `Yes, all in group for this session` for networks). */
	sessionLabel?: string;
	/** Offer `Yes, always…` (default on). */
	remember?: boolean;
	/**
	 * Network asks only (ADR-024): `Yes, just this once` is the preselected option and an
	 * unanswered countdown resolves to Allow once. File and credential asks keep `No`
	 * preselected and an unanswered countdown blocks.
	 */
	allowFirst?: boolean;
	/** Per-screen footer; defaults to a sensible choice from `allowFirst`. Pass `null` to suppress. */
	footer?: string | null;
	/** Prefix the title with an icon. */
	icon?: IconKey;
	/** Test seam; defaults to {@link ASK_TIMEOUT_MS}. */
	timeoutMs?: number;
};

/**
 * Compose header + icon + body + options for screen 1. Option order is always
 * No / Yes (just this once) / session / remember; ADR-024 preselects "Yes, just
 * this once" for network (allowFirst), so `No` stays in the list but is not
 * highlighted.
 */
export async function askMain(ctx: AskCtx, header: string, body: string, opts: MainOpts = {}): Promise<MainChoice> {
	const sessionLabel = opts.sessionLabel ?? "Yes, for this session";
	const choices: Array<{ label: string; value: MainChoice }> = [];
	choices.push({ label: "No", value: MainChoice.Block });
	if (opts.once !== false) choices.push({ label: "Yes, just this once", value: MainChoice.Once });
	if (opts.session) choices.push({ label: sessionLabel, value: MainChoice.Session });
	if (opts.remember !== false) choices.push({ label: "Yes, always\u2026", value: MainChoice.Remember });
	const footer = opts.footer ?? (opts.allowFirst
		? "Default: Yes, just this once"
		: "Default: No");
	const title = [withIcon(opts.icon ? ICON[opts.icon] : undefined, header), body].join("\n");
	const { picked, expired } = await askSelect(ctx, title, choices.map((c) => c.label), opts.timeoutMs, { footer });
	if (expired && opts.allowFirst) return MainChoice.Once;
	return choices.find((c) => c.label === picked)?.value ?? MainChoice.Block;
}

export type ScopeChoice = { scope: GrantScope; folder: boolean };

/**
 * Screen 2 options for a file: `All in folder / Only <name>` × `in this project
 * / in all projects`. Folder is preselected. The cwd rows are hidden when the
 * project isn't trusted, so the user cannot pick a grant that persistOverride
 * would reject.
 */
export async function askRememberFile(
	ctx: AskCtx,
	title: string,
	body: string,
	filePath: string,
	folderPath: string | null,
	opts: { icon?: IconKey; untrusted?: boolean; footer?: string | null } = {},
): Promise<ScopeChoice | null> {
	const basename = filePath.slice(filePath.lastIndexOf("/") + 1);
	const folderLabel = folderPath ? `All in folder   in this project   (recommended)` : null;
	const choices: Array<{ label: string; value: ScopeChoice }> = [];
	const showCwd = !opts.untrusted;
	if (showCwd && folderLabel) choices.push({ label: folderLabel, value: { scope: GrantScope.Cwd, folder: true } });
	if (showCwd) choices.push({ label: `Only ${basename}   in this project`, value: { scope: GrantScope.Cwd, folder: false } });
	if (folderLabel) choices.push({ label: `All in folder   in all projects`, value: { scope: GrantScope.Global, folder: true } });
	choices.push({ label: `Only ${basename}   in all projects`, value: { scope: GrantScope.Global, folder: false } });
	const footer = opts.footer ?? `Default: ${folderLabel ? "All in folder \u00b7 in this project" : `Only ${basename} \u00b7 in this project`}`;
	const prompt = [withIcon(opts.icon ? ICON[opts.icon] : undefined, title), body].join("\n");
	const { picked } = await askSelect(ctx, prompt, choices.map((c) => c.label), undefined, { skipQueue: true, footer });
	return choices.find((c) => c.label === picked)?.value ?? null;
}

/** The screen 2 default \u2014 `pattern` is the actual pattern persisted into the allowlist.
 * For 3+ part hosts (`backend.composio.dev`) the default is the parent-domain wildcard
 * (`*.composio.dev`) so one click covers every subdomain; for 2-part hosts (`example.com`)
 * the only sensible pattern is the host. ADR-030. */
export type HostGrant = { scope: GrantScope; pattern: string };

/** `*.composio.dev` from `backend.composio.dev`; `example.com` from `example.com`. */
export function parentDomainWildcard(host: string): string {
	const parts = host.toLowerCase().split(".");
	if (parts.length <= 2) return host;
	return `*.${parts.slice(-2).join(".")}`;
}

/** Screen 2 for a domain subject. ADR-030: wildcard subdomain is offered FIRST when the host
 * has a useful parent domain, so the default grant covers siblings without re-prompting.
 * `pattern` is the actual pattern written to the allowlist. v3.5.7: skipQueue=true so
 * screen 2 runs immediately after screen 1's pick — no other queued prompt can
 * interleave between them. */
export async function askRememberHost(
	ctx: AskCtx,
	title: string,
	body: string,
	host: string,
	opts: { icon?: IconKey; untrusted?: boolean; footer?: string | null } = {},
): Promise<HostGrant | null> {
	const wildcard = parentDomainWildcard(host);
	const hasWildcard = wildcard !== host.toLowerCase();
	const choices: Array<{ label: string; value: HostGrant }> = [];
	const showCwd = !opts.untrusted;
	const groupLabel = `All in group   ${hasWildcard ? `(${wildcard})   ` : ""}in this project   (recommended)`;
	const exactLabel = `Only ${host}   in this project`;
	if (showCwd && hasWildcard) choices.push({ label: groupLabel, value: { scope: GrantScope.Cwd, pattern: wildcard } });
	if (showCwd) choices.push({ label: exactLabel, value: { scope: GrantScope.Cwd, pattern: host } });
	if (hasWildcard) choices.push({ label: `All in group   (${wildcard})   in all projects`, value: { scope: GrantScope.Global, pattern: wildcard } });
	choices.push({ label: `Only ${host}   in all projects`, value: { scope: GrantScope.Global, pattern: host } });
	const footer = opts.footer ?? `Default: ${hasWildcard ? `All in group (${wildcard}) \u00b7 in this project` : `Only ${host} \u00b7 in this project`}`;
	const prompt = [withIcon(opts.icon ? ICON[opts.icon] : undefined, title), body].join("\n");
	const { picked } = await askSelect(ctx, prompt, choices.map((c) => c.label), undefined, { skipQueue: true, footer });
	const found = choices.find((c) => c.label === picked);
	return found?.value ?? null;
}

export const ExposureChoice = {
	Block: "block",
	Allow: "allow",
	ProgramSession: "program-session",
} as const;
export type ExposureChoice = (typeof ExposureChoice)[keyof typeof ExposureChoice];

/** Advanced Secure output gate (ADR-018): show where it was found and ask before the output reaches the model.
 *  When `programId` is set, an extra option lets the user grant the rest of the
 *  session for that program — same pattern as path/host session grants, but for
 *  tool output (display, not access). */
export async function askExposure(ctx: AskCtx, hits: string[], programId?: string): Promise<ExposureChoice> {
	const choices: Array<{ label: string; value: ExposureChoice }> = [
		{ label: "No, keep it hidden   (recommended)", value: ExposureChoice.Block },
		{ label: "Yes, show it this once", value: ExposureChoice.Allow },
	];
	if (programId) choices.push({ label: `Yes, all ${programId} output for this session`, value: ExposureChoice.ProgramSession });
	const titleParts = [
		`${ICON.cred}  This output may contain a secret \u2014 show it to the AI?`,
		"",
		hits.join("\n\n"),
		"",
		"Note     you'll be asked again each time a secret shows up",
	];
	const { picked } = await askSelect(ctx, titleParts.join("\n"), choices.map((c) => c.label), undefined, { footer: "Default: No" });
	return choices.find((c) => c.label === picked)?.value ?? ExposureChoice.Block;
}

/**
 * The model-facing notice when Advanced Secure withholds output. Never empty
 * and never phrased as a failure, so the model treats it as a deliberate block
 * by the user, not a broken tool or an empty result.
 */
export function withheldNotice(subject: string): string {
	return [
		`\u26a0 Output from \`${subject}\` was withheld because it may contain sensitive information.`,
		"",
		"The tool completed successfully, but the output is unavailable.",
		"Continue with the available information, or ask the user to allow access if the output is needed.",
	].join("\n");
}