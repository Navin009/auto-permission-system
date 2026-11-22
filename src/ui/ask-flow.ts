import { GrantScope } from "../core/index.ts";
import { POLICY_NOTICE } from "../shared/messages.ts";

export type AskComponent = {
	render(width: number): string[];
	handleInput?(data: string): void;
	invalidate?(): void;
	dispose?(): void;
};

export type AskTheme = {
	fg(color: string, text: string): string;
	bold(text: string): string;
};

export type AskKeybindings = {
	matches(data: string, action: string): boolean;
};

export type AskTui = {
	requestRender(): void;
};

export type AskCustomUi = (
	factory: (
		tui: AskTui,
		theme: AskTheme,
		keybindings: AskKeybindings,
		done: (result: string | undefined) => void,
	) => AskComponent,
) => Promise<string | undefined>;

export type AskCtx = {
	hasUI?: boolean;

	mode?: string;
	ui: {
		select: (t: string, o: string[], op?: { timeout?: number; signal?: AbortSignal }) => Promise<string | undefined>;

		custom?: AskCustomUi;

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

export const ASK_TIMEOUT_MS = 15_000;

export const ICON = {
	ask: "❓",
	warn: "⚠",
	cred: "🔑",
	net: "🌐",
	save: "💾",
} as const;
export type IconKey = keyof typeof ICON;

const ASK_CHAIN_GLOBAL = "__autoPermissionSystemAskChain__";
type AskChainGlobal = typeof globalThis & { [ASK_CHAIN_GLOBAL]?: Promise<unknown> };

function queueTail(): Promise<unknown> {
	const g = globalThis as AskChainGlobal;
	g[ASK_CHAIN_GLOBAL] ??= Promise.resolve();
	return g[ASK_CHAIN_GLOBAL];
}

let holdingQueue = false;

async function enqueue<T>(fn: () => Promise<T>): Promise<T> {
	if (holdingQueue) return fn();
	const run = async (): Promise<T> => {
		holdingQueue = true;
		try {
			return await fn();
		} finally {
			holdingQueue = false;
		}
	};
	const queued = queueTail().then(run, run);
	(globalThis as AskChainGlobal)[ASK_CHAIN_GLOBAL] = queued.then(
		() => undefined,
		() => undefined,
	);
	return queued;
}

export async function askQueued(
	ctx: AskCtx,
	title: string,
	options: string[],
	timeoutMs?: number,
): Promise<string | undefined> {
	return enqueue(() => ctx.ui.select(title, options, timeoutMs === undefined ? undefined : { timeout: timeoutMs }));
}

export async function askSelect(
	ctx: AskCtx,
	title: string,
	options: string[],
	timeoutMs: number = ASK_TIMEOUT_MS,
	opts: { footer?: string | null; question?: string | null; note?: string | null } = {},
): Promise<{ picked: string | undefined; expired: boolean }> {
	const footer = opts.footer ?? null;
	const question = opts.question ?? null;
	const note = opts.note ?? null;

	return enqueue(async () => {
		if (ctx.mode === "tui" && typeof ctx.ui.custom === "function") {
			return askWithCustom(ctx, title, options, timeoutMs, footer, question, note);
		}

		return askWithSelect(ctx, title, options, timeoutMs, footer, question, note);
	});
}

async function askWithCustom(
	ctx: AskCtx,
	title: string,
	options: string[],
	timeoutMs: number,
	footer: string | null,
	question: string | null,
	note: string | null,
): Promise<{ picked: string | undefined; expired: boolean }> {
	const { AskSelector } = await import("./ask-selector.ts");
	let expired = false;
	const picked = await ctx.ui.custom!(
		(tui, theme, keybindings, done) =>
			new AskSelector({
				title,
				footer,
				question,
				note,
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

async function askWithSelect(
	ctx: AskCtx,
	title: string,
	options: string[],
	timeoutMs: number,
	footer: string | null,
	question: string | null,
	note: string | null,
): Promise<{ picked: string | undefined; expired: boolean }> {
	let boundedTitle = question ? `${title}\n\n${question}` : title;

	if (note) boundedTitle = `${boundedTitle}\n\n${note}`;

	const lines = boundedTitle.split("\n");
	const MAX_FALLBACK_LINES = 16;
	if (lines.length > MAX_FALLBACK_LINES) {
		const header = lines[0];
		const preview = lines.slice(1, MAX_FALLBACK_LINES).join("\n");
		boundedTitle = `${header}\n${preview}\n\n[... ${lines.length - MAX_FALLBACK_LINES} more lines truncated]`;
	}

	const selectTitle = footer ? `${boundedTitle}\n\n${footer}` : boundedTitle;
	if (timeoutMs === 0) {
		const picked = await ctx.ui.select(selectTitle, options);
		return { picked, expired: false };
	}
	return askSelectWithActivity(ctx, selectTitle, options, timeoutMs);
}

async function askSelectWithActivity(
	ctx: AskCtx,
	title: string,
	options: string[],
	timeoutMs: number,
): Promise<{ picked: string | undefined; expired: boolean }> {
	if (timeoutMs === 0) return { picked: await ctx.ui.select(title, options), expired: false };

	let settled = false;
	let engaged = false;
	let expired = false;
	let currentTimer: ReturnType<typeof setTimeout> | null = null;
	const started = Date.now();
	const ctrl = new AbortController();
	const clearTimer = (): void => {
		if (currentTimer) {
			clearTimeout(currentTimer);
			currentTimer = null;
		}
	};
	let offInput: () => void = () => {};

	const finish = (): void => {
		if (settled) return;
		settled = true;
		clearTimer();
		if (!ctrl.signal.aborted) ctrl.abort();
		offInput();
	};

	offInput =
		ctx.ui.onTerminalInput?.((data: string) => {
			if (settled || engaged) return;
			if (data.includes("\x1b[") || data === "\t" || data === "\r" || data === "\n") {
				engaged = true;
				clearTimer();
			}
		}) ?? (() => {});

	currentTimer = setTimeout(() => {
		expired = true;
		finish();
	}, timeoutMs);

	const picked = await ctx.ui.select(title, options, { signal: ctrl.signal });
	if (settled) return { picked: undefined, expired };
	settled = true;
	clearTimer();
	offInput();

	const expiredByElapsed = !engaged && picked === undefined && Date.now() - started >= timeoutMs;
	return { picked, expired: expiredByElapsed };
}

function withIcon(icon: string | undefined, header: string): string {
	return icon ? `${icon}  ${header}` : header;
}

export type MainOpts = {
	once?: boolean;

	session?: boolean;

	sessionLabel?: string;

	remember?: boolean;

	footer?: string | null;

	icon?: IconKey;

	timeoutMs?: number;
};

export async function askMain(ctx: AskCtx, header: string, body: string, opts: MainOpts = {}): Promise<MainChoice> {
	const sessionLabel = opts.sessionLabel ?? "Yes, for this conversation";
	const choices: Array<{ label: string; value: MainChoice }> = [];
	choices.push({ label: "No", value: MainChoice.Block });
	if (opts.once !== false) choices.push({ label: "Yes, just this once", value: MainChoice.Once });
	if (opts.session) choices.push({ label: sessionLabel, value: MainChoice.Session });
	if (opts.remember !== false) choices.push({ label: "Yes, always\u2026", value: MainChoice.Remember });
	const footer = opts.footer ?? "Default: No";
	const title = [withIcon(opts.icon ? ICON[opts.icon] : undefined, header), body].join("\n");
	const { picked } = await askSelect(
		ctx,
		title,
		choices.map((c) => c.label),
		opts.timeoutMs,
		{ footer },
	);

	return choices.find((c) => c.label === picked)?.value ?? MainChoice.Block;
}

export async function askMainWithRemember<T>(
	ctx: AskCtx,
	header: string,
	body: string,
	opts: MainOpts,
	onRemember: () => Promise<T | null>,
): Promise<{ choice: MainChoice; grant: T | null }> {
	return enqueue(async () => {
		const choice = await askMain(ctx, header, body, opts);
		if (choice !== MainChoice.Remember) return { choice, grant: null };
		const grant = await onRemember();
		return { choice, grant };
	});
}

export type ScopeChoice = { scope: GrantScope; folder: boolean };

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
	if (showCwd)
		choices.push({ label: `Only ${basename}   in this project`, value: { scope: GrantScope.Cwd, folder: false } });
	if (folderLabel)
		choices.push({ label: `All in folder   in all projects`, value: { scope: GrantScope.Global, folder: true } });
	choices.push({ label: `Only ${basename}   in all projects`, value: { scope: GrantScope.Global, folder: false } });
	const footer =
		opts.footer ??
		`Default: ${folderLabel ? "All in folder \u00b7 in this project" : `Only ${basename} \u00b7 in this project`}`;
	const prompt = [withIcon(opts.icon ? ICON[opts.icon] : undefined, title), body].join("\n");
	const { picked } = await askSelect(
		ctx,
		prompt,
		choices.map((c) => c.label),
		undefined,
		{ footer },
	);
	return choices.find((c) => c.label === picked)?.value ?? null;
}

export type HostGrant = { scope: GrantScope; pattern: string };

export function parentDomainWildcard(host: string): string {
	const parts = host.toLowerCase().split(".");
	if (parts.length <= 2) return host;
	return `*.${parts.slice(-2).join(".")}`;
}

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
	if (hasWildcard)
		choices.push({
			label: `All in group   (${wildcard})   in all projects`,
			value: { scope: GrantScope.Global, pattern: wildcard },
		});
	choices.push({ label: `Only ${host}   in all projects`, value: { scope: GrantScope.Global, pattern: host } });
	const footer =
		opts.footer ??
		`Default: ${hasWildcard ? `All in group (${wildcard}) \u00b7 in this project` : `Only ${host} \u00b7 in this project`}`;
	const prompt = [withIcon(opts.icon ? ICON[opts.icon] : undefined, title), body].join("\n");
	const { picked } = await askSelect(
		ctx,
		prompt,
		choices.map((c) => c.label),
		undefined,
		{ footer },
	);
	const found = choices.find((c) => c.label === picked);
	return found?.value ?? null;
}

export const ExposureChoice = {
	Block: "block",
	Allow: "allow",
	ProgramSession: "program-session",
} as const;
export type ExposureChoice = (typeof ExposureChoice)[keyof typeof ExposureChoice];

export async function askExposure(ctx: AskCtx, hits: string[], programId?: string): Promise<ExposureChoice> {
	const choices: Array<{ label: string; value: ExposureChoice }> = [
		{ label: "No, keep it hidden   (recommended)", value: ExposureChoice.Block },
		{ label: "Yes, show it this once", value: ExposureChoice.Allow },
	];
	if (programId)
		choices.push({ label: `Yes, all ${programId} output for this conversation`, value: ExposureChoice.ProgramSession });
	const titleParts = [`${ICON.warn}  Sensitive information detected`, hits.join("\n\n")];
	const { picked } = await askSelect(
		ctx,
		titleParts.join("\n"),
		choices.map((c) => c.label),
		undefined,
		{
			footer: "Default: No",
			question: "Question Should the AI be allowed to see it?",
			note: "Note     you'll be asked again each time a secret shows up",
		},
	);
	return choices.find((c) => c.label === picked)?.value ?? ExposureChoice.Block;
}

export function withheldNotice(subject: string): string {
	return [
		`${POLICY_NOTICE} Output from \`${subject}\` was hidden because it contains sensitive credentials.`,
		"",
		"The tool completed successfully, but the output is unavailable.",
		"Continue with the available information, or ask the user to allow access if the output is needed.",
	].join("\n");
}
