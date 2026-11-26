import { GrantScope } from "#core/index.ts";
import { rememberNativeNote } from "#shared/gate-notes.ts";
import { POLICY_NOTICE } from "#shared/messages.ts";
import {
	formatPromptBodyLines,
	normalizeAskOption,
	type AskOptionItem,
	type PromptBody,
	type PromptField,
	type PromptFinding,
	type PromptOption,
} from "./prompt-spec.ts";

export type { AskOptionItem, PromptBody, PromptField, PromptFinding, PromptOption };

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

		notify?: (message: string, level?: string) => void;

		onTerminalInput?: (handler: (data: string) => void) => () => void;
	};
};

export const MainChoice = {
	Block: "block",
	TimedOut: "timed-out",
	Once: "once",
	Session: "session",
	Remember: "remember",
} as const;
export type MainChoice = (typeof MainChoice)[keyof typeof MainChoice];

export const ASK_TIMEOUT_MS = 15_000;

let lastSelectExpired = false;

export function formatTimeoutNote(timeoutMs: number = ASK_TIMEOUT_MS): string {
	const seconds = Math.max(1, Math.round(timeoutMs / 1000));

	return `Timed out after ${seconds}s — blocked by default`;
}

export function notifyPromptTimeout(
	ctx: AskCtx,
	toolCallId: string | undefined,
	timeoutMs: number = ASK_TIMEOUT_MS,
): void {
	const note = formatTimeoutNote(timeoutMs);

	if (toolCallId) {
		rememberNativeNote(toolCallId, note);
		return;
	}

	ctx.ui.notify?.(`${note}.`, "warning");
}

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

export interface AskSelectOptions {
	footer?: string | null;
	question?: string | null;
	note?: string | null;
	fields?: readonly PromptField[];
	findings?: readonly PromptFinding[];
}

export async function askSelect(
	ctx: AskCtx,
	title: string,
	options: readonly PromptOption[],
	timeoutMs: number = ASK_TIMEOUT_MS,
	opts: AskSelectOptions = {},
): Promise<{ picked: string | undefined; expired: boolean }> {
	const footer = opts.footer ?? null;
	const question = opts.question ?? null;
	const note = opts.note ?? null;
	const normalizedOptions = options.map(normalizeAskOption);

	return enqueue(async () => {
		lastSelectExpired = false;

		const outcome =
			ctx.mode === "tui" && typeof ctx.ui.custom === "function"
				? await askWithCustom(ctx, title, normalizedOptions, timeoutMs, {
						footer,
						question,
						note,
						fields: opts.fields,
						findings: opts.findings,
					})
				: await askWithSelect(ctx, title, normalizedOptions, timeoutMs, {
						footer,
						question,
						note,
						fields: opts.fields,
						findings: opts.findings,
					});

		lastSelectExpired = outcome.expired;

		return outcome;
	});
}

async function askWithCustom(
	ctx: AskCtx,
	title: string,
	options: readonly AskOptionItem[],
	timeoutMs: number,
	opts: {
		footer: string | null;
		question: string | null;
		note: string | null;
		fields?: readonly PromptField[];
		findings?: readonly PromptFinding[];
	},
): Promise<{ picked: string | undefined; expired: boolean }> {
	const { AskSelector } = await import("./ask-selector.ts");
	let expired = false;
	const picked = await ctx.ui.custom!(
		(tui, theme, keybindings, done) =>
			new AskSelector({
				title,
				fields: opts.fields,
				findings: opts.findings,
				footer: opts.footer,
				question: opts.question,
				note: opts.note,
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

function buildFallbackTitle(
	title: string,
	fields: readonly PromptField[] | undefined,
	findings: readonly PromptFinding[] | undefined,
): string {
	if (!fields?.length && !findings?.length) {
		return title;
	}

	const bodyLines = formatPromptBodyLines({ fields: fields ?? [], findings });

	return bodyLines.length > 0 ? `${title}\n${bodyLines.join("\n")}` : title;
}

async function askWithSelect(
	ctx: AskCtx,
	title: string,
	options: readonly AskOptionItem[],
	timeoutMs: number,
	opts: {
		footer: string | null;
		question: string | null;
		note: string | null;
		fields?: readonly PromptField[];
		findings?: readonly PromptFinding[];
	},
): Promise<{ picked: string | undefined; expired: boolean }> {
	let boundedTitle = buildFallbackTitle(title, opts.fields, opts.findings);

	if (opts.question) {
		boundedTitle = `${boundedTitle}\n\n${opts.question}`;
	}

	if (opts.note) {
		boundedTitle = `${boundedTitle}\n\n${opts.note}`;
	}

	const lines = boundedTitle.split("\n");
	const MAX_FALLBACK_LINES = 16;

	if (lines.length > MAX_FALLBACK_LINES) {
		const header = lines[0];
		const preview = lines.slice(1, MAX_FALLBACK_LINES).join("\n");
		boundedTitle = `${header}\n${preview}\n\n[... ${lines.length - MAX_FALLBACK_LINES} more lines truncated]`;
	}

	const selectTitle = opts.footer ? `${boundedTitle}\n\n${opts.footer}` : boundedTitle;
	const optionLabels = options.map((option) => option.fallbackLabel ?? option.value);

	const mapPick = (pickedLabel: string | undefined): string | undefined => {
		if (pickedLabel === undefined) return undefined;
		const index = optionLabels.indexOf(pickedLabel);
		return index >= 0 ? options[index].value : pickedLabel;
	};

	if (timeoutMs === 0) {
		const picked = await ctx.ui.select(selectTitle, optionLabels);
		return { picked: mapPick(picked), expired: false };
	}

	const outcome = await askSelectWithActivity(ctx, selectTitle, optionLabels, timeoutMs);

	return { picked: mapPick(outcome.picked), expired: outcome.expired };
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

function splitPromptContent(header: string, body: string | PromptBody, icon?: IconKey) {
	const prefixedHeader = withIcon(icon ? ICON[icon] : undefined, header);

	if (typeof body === "string") {
		return {
			title: body ? `${prefixedHeader}\n${body}` : prefixedHeader,
			fields: undefined,
			findings: undefined,
		};
	}

	return {
		title: prefixedHeader,
		fields: body.fields,
		findings: body.findings,
	};
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

export async function askMain(
	ctx: AskCtx,
	header: string,
	body: string | PromptBody,
	opts: MainOpts = {},
): Promise<MainChoice> {
	const sessionLabel = opts.sessionLabel ?? "Yes, for this conversation";
	const choices: Array<AskOptionItem & { choiceValue: MainChoice }> = [];

	choices.push({ value: "No", label: "No", key: "n", choiceValue: MainChoice.Block });
	if (opts.once !== false) {
		choices.push({
			value: "Yes, just this once",
			label: "Yes, just this once",
			key: "y",
			choiceValue: MainChoice.Once,
		});
	}
	if (opts.session) {
		choices.push({ value: sessionLabel, label: sessionLabel, key: "s", choiceValue: MainChoice.Session });
	}
	if (opts.remember !== false) {
		choices.push({
			value: "Yes, always\u2026",
			label: "Yes, always\u2026",
			key: "a",
			choiceValue: MainChoice.Remember,
		});
	}

	const footer = opts.footer ?? "Default: No";
	const content = splitPromptContent(header, body, opts.icon);
	const { picked, expired } = await askSelect(ctx, content.title, choices, opts.timeoutMs, {
		footer,
		fields: content.fields,
		findings: content.findings,
	});

	if (expired) {
		return MainChoice.TimedOut;
	}

	return choices.find((c) => c.value === picked)?.choiceValue ?? MainChoice.Block;
}

export async function askMainWithRemember<T>(
	ctx: AskCtx,
	header: string,
	body: string | PromptBody,
	opts: MainOpts,
	onRemember: () => Promise<T | null>,
): Promise<{ choice: MainChoice; grant: T | null }> {
	return enqueue(async () => {
		const choice = await askMain(ctx, header, body, opts);
		if (choice !== MainChoice.Remember) return { choice, grant: null };

		const grant = await onRemember();
		if (grant === null && lastSelectExpired) {
			return { choice: MainChoice.TimedOut, grant: null };
		}

		return { choice, grant };
	});
}

export type ScopeChoice = { scope: GrantScope; folder: boolean };

export async function askRememberFile(
	ctx: AskCtx,
	title: string,
	body: string | PromptBody,
	filePath: string,
	folderPath: string | null,
	opts: { icon?: IconKey; untrusted?: boolean; footer?: string | null } = {},
): Promise<ScopeChoice | null> {
	const basename = filePath.slice(filePath.lastIndexOf("/") + 1);
	const choices: Array<AskOptionItem & { choiceValue: ScopeChoice }> = [];
	const showCwd = !opts.untrusted;

	if (showCwd && folderPath) {
		choices.push({
			value: "All in folder   in this project   (recommended)",
			label: "All in folder (recommended)",
			description: "in this project",
			choiceValue: { scope: GrantScope.Cwd, folder: true },
		});
	}

	if (showCwd) {
		choices.push({
			value: `Only ${basename}   in this project`,
			label: `Only ${basename}`,
			description: "in this project",
			choiceValue: { scope: GrantScope.Cwd, folder: false },
		});
	}

	if (folderPath) {
		choices.push({
			value: "All in folder   in all projects",
			label: "All in folder",
			description: "in all projects",
			choiceValue: { scope: GrantScope.Global, folder: true },
		});
	}

	choices.push({
		value: `Only ${basename}   in all projects`,
		label: `Only ${basename}`,
		description: "in all projects",
		choiceValue: { scope: GrantScope.Global, folder: false },
	});

	const footer =
		opts.footer ??
		`Default: ${folderPath ? "All in folder \u00b7 in this project" : `Only ${basename} \u00b7 in this project`}`;
	const content = splitPromptContent(title, body, opts.icon);
	const { picked } = await askSelect(ctx, content.title, choices, undefined, {
		footer,
		fields: content.fields,
		findings: content.findings,
	});

	return choices.find((c) => c.value === picked)?.choiceValue ?? null;
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
	body: string | PromptBody,
	host: string,
	opts: { icon?: IconKey; untrusted?: boolean; footer?: string | null } = {},
): Promise<HostGrant | null> {
	const wildcard = parentDomainWildcard(host);
	const hasWildcard = wildcard !== host.toLowerCase();
	const choices: Array<AskOptionItem & { choiceValue: HostGrant }> = [];
	const showCwd = !opts.untrusted;

	if (showCwd && hasWildcard) {
		choices.push({
			value: `All in group   (${wildcard})   in this project   (recommended)`,
			label: `All in group (${wildcard}) (recommended)`,
			description: "in this project",
			choiceValue: { scope: GrantScope.Cwd, pattern: wildcard },
		});
	}

	if (showCwd) {
		choices.push({
			value: `Only ${host}   in this project`,
			label: `Only ${host}`,
			description: "in this project",
			choiceValue: { scope: GrantScope.Cwd, pattern: host },
		});
	}

	if (hasWildcard) {
		choices.push({
			value: `All in group   (${wildcard})   in all projects`,
			label: `All in group (${wildcard})`,
			description: "in all projects",
			choiceValue: { scope: GrantScope.Global, pattern: wildcard },
		});
	}

	choices.push({
		value: `Only ${host}   in all projects`,
		label: `Only ${host}`,
		description: "in all projects",
		choiceValue: { scope: GrantScope.Global, pattern: host },
	});

	const footer =
		opts.footer ??
		`Default: ${hasWildcard ? `All in group (${wildcard}) \u00b7 in this project` : `Only ${host} \u00b7 in this project`}`;
	const content = splitPromptContent(title, body, opts.icon);
	const { picked } = await askSelect(ctx, content.title, choices, undefined, {
		footer,
		fields: content.fields,
		findings: content.findings,
	});

	return choices.find((c) => c.value === picked)?.choiceValue ?? null;
}

export const ExposureChoice = {
	Block: "block",
	TimedOut: "timed-out",
	Allow: "allow",
	ProgramSession: "program-session",
} as const;
export type ExposureChoice = (typeof ExposureChoice)[keyof typeof ExposureChoice];

export async function askExposure(ctx: AskCtx, hits: string[], programId?: string): Promise<ExposureChoice> {
	const choices: Array<AskOptionItem & { choiceValue: ExposureChoice }> = [
		{
			value: "No, keep it hidden   (recommended)",
			label: "No, keep it hidden (recommended)",
			key: "n",
			choiceValue: ExposureChoice.Block,
		},
		{
			value: "Yes, show it this once",
			label: "Yes, show it this once",
			key: "y",
			choiceValue: ExposureChoice.Allow,
		},
	];

	if (programId) {
		choices.push({
			value: `Yes, all ${programId} output for this conversation`,
			label: `Yes, all ${programId} output for this conversation`,
			key: "s",
			choiceValue: ExposureChoice.ProgramSession,
		});
	}

	const titleParts = [`${ICON.warn}  Sensitive information detected`, hits.join("\n\n")];
	const { picked, expired } = await askSelect(ctx, titleParts.join("\n"), choices, undefined, {
		footer: "Default: No",
		question: "Question Should the AI be allowed to see it?",
		note: "Note     you'll be asked again each time a secret shows up",
	});

	if (expired) {
		return ExposureChoice.TimedOut;
	}

	return choices.find((c) => c.value === picked)?.choiceValue ?? ExposureChoice.Block;
}

export function withheldNotice(subject: string): string {
	return [
		`${POLICY_NOTICE} Output from \`${subject}\` was hidden because it contains sensitive credentials.`,
		"",
		"The tool completed successfully, but the output is unavailable.",
		"Continue with the available information, or ask the user to allow access if the output is needed.",
	].join("\n");
}
