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

export type AskCtx = {
	hasUI?: boolean;
	ui: {
		select: (t: string, o: string[], op?: { timeout?: number; signal?: AbortSignal }) => Promise<string | undefined>;
		/** Optional — only present in interactive TUI mode. Tests/scripts use a stub. */
		onTerminalInput?: (handler: (data: string) => void) => () => void;
		/** Optional — writes a status line to the TUI footer (below the select modal).
		 *  When the select is open, the status bar sits visually below the options. */
		setStatus?: (key: string, text: string | undefined) => void;
	};
};

export type MainChoice = "block" | "once" | "session" | "remember";

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
 * Show a "Default: <action> (Ns)" status line in the TUI footer (below the select modal)
 * for the lifetime of a prompt. The line hides on any keystroke and re-appears after a
 * short idle, so the countdown is visible when the user is reading options but doesn't
 * get in the way of navigation. The countdown is measured from `lastActivity`, not from
 * prompt open — so it visually resets when the user starts navigating (the v3.5.6
 * user-visible behavior, achieved without the abort+reissue flicker).
 *
 * Returns a cleanup function that removes the listener, clears the interval, and clears
 * the status. No-op if `text` is null (caller wants to suppress the footer) or if the
 * ctx has no `setStatus` (stub UIs / tests) or `timeoutMs === 0` (no countdown).
 */
function attachAskStatusBar(
	ctx: AskCtx,
	text: string | null,
	timeoutMs: number,
): () => void {
	if (!text || !ctx.ui.setStatus || timeoutMs === 0) return () => {};
	const setStatus = ctx.ui.setStatus;
	const key = "aps-ask-timer";
	let lastActivity = Date.now();
	let restoreTimer: ReturnType<typeof setTimeout> | null = null;
	let interval: ReturnType<typeof setInterval> | null = null;
	let settled = false;

	const getRemaining = (): number => {
		const elapsed = Date.now() - lastActivity;
		return Math.max(0, Math.ceil((timeoutMs - elapsed) / 1000));
	};
	const show = (): void => {
		const s = getRemaining();
		setStatus(key, s > 0 ? `${text} (${s}s)` : undefined);
	};
	const hide = (): void => {
		setStatus(key, undefined);
	};

	const offInput = ctx.ui.onTerminalInput?.(() => {
		if (settled) return;
		lastActivity = Date.now();
		hide();
		if (restoreTimer) clearTimeout(restoreTimer);
		restoreTimer = setTimeout(() => {
			restoreTimer = null;
			if (!settled) show();
		}, 300);
	}) ?? (() => {});

	show();
	interval = setInterval(() => { if (!restoreTimer) show(); }, 1000);

	return () => {
		settled = true;
		if (interval) clearInterval(interval);
		if (restoreTimer) clearTimeout(restoreTimer);
		offInput();
		hide();
	};
}

/**
 * One serialized `ui.select`. `expired` separates the countdown running out
 * from an early Esc: both resolve `undefined` in pi, only the countdown is
 * the prompt's default. Measured inside the lock, so time spent queued
 * behind another prompt never counts.
 *
 * Activity extension (v3.5.3): when the user presses ↑/↓/Tab/Home/End/PgUp/PgDn
 * while the prompt is open, the timeout is reset. They aren't being idle —
 * they're reading options and deciding. Setting `timeoutMs` to `0` disables
 * the countdown entirely (the prompt stays open until pick or Esc).
 *
 * v3.5.7: `skipQueue` runs the select immediately, bypassing the FIFO queue.
 * The screen-2 helpers (askRememberFile/AskRememberHost) use this so
 * screen 2 always runs immediately after screen 1's pick — no other queued
 * prompt can interleave between them.
 */
export async function askSelect(
	ctx: AskCtx,
	title: string,
	options: string[],
	timeoutMs: number = ASK_TIMEOUT_MS,
	opts: { skipQueue?: boolean } = {},
): Promise<{ picked: string | undefined; expired: boolean }> {
	const run = async (): Promise<{ picked: string | undefined; expired: boolean }> => {
		if (timeoutMs === 0) {
			const picked = await ctx.ui.select(title, options);
			return { picked, expired: false };
		}
		const started = Date.now();
		const picked = await askSelectWithActivity(ctx, title, options, timeoutMs);
		return { picked, expired: picked === undefined && Date.now() - started >= timeoutMs };
	};
	if (opts.skipQueue) return run();
	const queued = queueTail().then(run, run);
	(globalThis as AskChainGlobal)[ASK_CHAIN_GLOBAL] = queued.then(() => undefined, () => undefined);
	return queued;
}

/**
 * `ui.select` with activity-based timer extension. v3.5.10: pi's "(Ns)"
 * countdown is NOT passed to `ctx.ui.select` (no flicker from abort+reissue);
 * instead the countdown is rendered in the TUI status bar by `attachAskStatusBar`
 * and hides on activity (see the helper). The outer timer is still reset on
 * navigation input so the user has more time while reading options. `timeoutMs === 0`
 * takes the no-countdown-no-auto-dismiss path (prompt stays open until pick or Esc).
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

	// No timeout passed to pi → no '(Ns)' countdown display.
	// Outer timer owns auto-dismiss; activity listener resets it.
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

/** Compose header + icon + body + options for screen 1. ADR-024 puts Yes first for network
 * (allowFirst), so `No` is still in the list but unhighlighted. */
export async function askMain(ctx: AskCtx, header: string, body: string, opts: MainOpts = {}): Promise<MainChoice> {
	const sessionLabel = opts.sessionLabel ?? "Yes, for this session";
	const choices: Array<{ label: string; value: MainChoice }> = [];
	// Order is always: No, Yes (just this once), session, remember. With
	// allowFirst=true, Enter picks "Yes, just this once" (the second row).
	choices.push({ label: "No", value: "block" });
	if (opts.once !== false) choices.push({ label: "Yes, just this once", value: "once" });
	if (opts.session) choices.push({ label: sessionLabel, value: "session" });
	if (opts.remember !== false) choices.push({ label: "Yes, always\u2026", value: "remember" });
	const footer = opts.footer ?? (opts.allowFirst
		? "Default: Yes, just this once"
		: "Default: No");
	const titleParts = [withIcon(opts.icon ? ICON[opts.icon] : undefined, header), body];
	// Footer is rendered in the TUI status bar (below the select modal) — not in the title.
	const cleanup = attachAskStatusBar(ctx, footer, opts.timeoutMs ?? ASK_TIMEOUT_MS);
	try {
		const { picked, expired } = await askSelect(ctx, titleParts.join("\n"), choices.map((c) => c.label), opts.timeoutMs);
		if (expired && opts.allowFirst) return "once";
		return choices.find((c) => c.label === picked)?.value ?? "block";
	} finally {
		cleanup();
	}
}

export type ScopeChoice = { scope: "cwd" | "global"; folder: boolean };

/** Screen 2 options for a file: `All in folder / Only <name>`
 * \u00d7 `in this project / in all projects`. Folder is preselected. */
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
	// The cwd rows are hidden when the project isn't trusted (ADR-031 follow-up).
	const showCwd = !opts.untrusted;
	if (showCwd && folderLabel) choices.push({ label: folderLabel, value: { scope: "cwd", folder: true } });
	if (showCwd) choices.push({ label: `Only ${basename}   in this project`, value: { scope: "cwd", folder: false } });
	if (folderLabel) choices.push({ label: `All in folder   in all projects`, value: { scope: "global", folder: true } });
	choices.push({ label: `Only ${basename}   in all projects`, value: { scope: "global", folder: false } });
	const footer = opts.footer ?? `Default: ${folderLabel ? "All in folder · in this project" : `Only ${basename} · in this project`}`;
	const titleParts = [withIcon(opts.icon ? ICON[opts.icon] : undefined, title), body];
	const cleanup = attachAskStatusBar(ctx, footer, ASK_TIMEOUT_MS);
	try {
		const { picked } = await askSelect(ctx, titleParts.join("\n"), choices.map((c) => c.label), undefined, { skipQueue: true });
		return choices.find((c) => c.label === picked)?.value ?? null;
	} finally {
		cleanup();
	}
}

/** The screen 2 default \u2014 `pattern` is the actual pattern persisted into the allowlist.
 * For 3+ part hosts (`backend.composio.dev`) the default is the parent-domain wildcard
 * (`*.composio.dev`) so one click covers every subdomain; for 2-part hosts (`example.com`)
 * the only sensible pattern is the host. ADR-030. */
export type HostGrant = { scope: "cwd" | "global"; pattern: string };

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
	if (showCwd && hasWildcard) choices.push({ label: groupLabel, value: { scope: "cwd", pattern: wildcard } });
	if (showCwd) choices.push({ label: exactLabel, value: { scope: "cwd", pattern: host } });
	if (hasWildcard) choices.push({ label: `All in group   (${wildcard})   in all projects`, value: { scope: "global", pattern: wildcard } });
	choices.push({ label: `Only ${host}   in all projects`, value: { scope: "global", pattern: host } });
	const footer = opts.footer ?? `Default: ${hasWildcard ? `All in group (${wildcard}) · in this project` : `Only ${host} · in this project`}`;
	const titleParts = [withIcon(opts.icon ? ICON[opts.icon] : undefined, title), body];
	const cleanup = attachAskStatusBar(ctx, footer, ASK_TIMEOUT_MS);
	try {
		const { picked } = await askSelect(ctx, titleParts.join("\n"), choices.map((c) => c.label), undefined, { skipQueue: true });
		const found = choices.find((c) => c.label === picked);
		return found?.value ?? null;
	} finally {
		cleanup();
	}
}

export type ExposureChoice = "allow" | "block" | "program-session";

/** Advanced Secure output gate (ADR-018): show where it was found and ask before the output reaches the model.
 *  When `programId` is set, an extra option lets the user grant the rest of the
 *  session for that program — same pattern as path/host session grants, but for
 *  tool output (display, not access). */
export async function askExposure(ctx: AskCtx, hits: string[], programId?: string): Promise<ExposureChoice> {
	const choices: Array<{ label: string; value: ExposureChoice }> = [
		{ label: "No, keep it hidden   (recommended)", value: "block" },
		{ label: "Yes, show it this once", value: "allow" },
	];
	if (programId) choices.push({ label: `Yes, all ${programId} output for this session`, value: "program-session" });
	const titleParts = [
		`${ICON.cred}  This output may contain a secret \u2014 show it to the AI?`,
		"",
		hits.join("\n\n"),
		"",
		"Note     you'll be asked again each time a secret shows up",
	];
	const cleanup = attachAskStatusBar(ctx, "Default: No", ASK_TIMEOUT_MS);
	try {
		const { picked } = await askSelect(ctx, titleParts.join("\n"), choices.map((c) => c.label));
		return choices.find((c) => c.label === picked)?.value ?? "block";
	} finally {
		cleanup();
	}
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