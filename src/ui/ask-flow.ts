/**
 * Shared ask-tier UI primitives for both layers. Pure: no pi, no OS, no fs —
 * it only calls the caller's `ctx.ui.select`, so the contract tests can script it.
 *
 * Screen 1: a short verdict + `Block (default)` / `Allow once` /
 *   `Allow for this session` / `Allow and remember…` (each optional per caller).
 *   Network asks (ADR-024) put `Allow (default)` first and `Deny` second; an
 *   unanswered countdown there counts as Allow once. Esc still denies.
 * Screen 2: only after "remember" — `Allow for this file|folder (<path>) -
 *   Scope this project|global`. Esc / timeout on either screen blocks.
 *
 * Every select is serialized: a second overlapping `ui.select` replaces the
 * first on screen, and the first one's countdown later tears down the newer
 * selector, whose promise never settles (ADR-024).
 */

export type AskCtx = {
	hasUI?: boolean;
	ui: {
		select: (t: string, o: string[], op?: { timeout?: number }) => Promise<string | undefined>;
	};
};

export type MainChoice = "block" | "once" | "session" | "remember";

/** How long a pending permission prompt waits before it resolves to its default. */
export const ASK_TIMEOUT_MS = 10_000;

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
 * One serialized `ui.select`. `expired` separates the countdown running out
 * from an early Esc: both resolve `undefined` in pi, only the countdown is
 * the prompt's default. Measured inside the lock, so time spent queued
 * behind another prompt never counts.
 */
export async function askSelect(
	ctx: AskCtx,
	title: string,
	options: string[],
	timeoutMs: number = ASK_TIMEOUT_MS,
): Promise<{ picked: string | undefined; expired: boolean }> {
	const run = async (): Promise<{ picked: string | undefined; expired: boolean }> => {
		const started = Date.now();
		const picked = await ctx.ui.select(title, options, { timeout: timeoutMs });
		return { picked, expired: picked === undefined && Date.now() - started >= timeoutMs };
	};
	const queued = queueTail().then(run, run);
	(globalThis as AskChainGlobal)[ASK_CHAIN_GLOBAL] = queued.then(() => undefined, () => undefined);
	return queued;
}

export type MainOpts = {
	/** Offer `Allow once` (default on). */
	once?: boolean;
	/** Offer `Allow for this session` (opt-in). */
	session?: boolean;
	/** Offer `Allow and remember…` (default on). */
	remember?: boolean;
	/**
	 * Network asks only (ADR-024): `Allow (default)` is the first, preselected
	 * option, `Deny` is second, and an unanswered countdown resolves to Allow
	 * once. File and credential asks keep `Block (default)` first and an
	 * unanswered countdown blocks.
	 */
	allowFirst?: boolean;
	/** Test seam; defaults to {@link ASK_TIMEOUT_MS}. */
	timeoutMs?: number;
};

/** Screen 1. `once` defaults on; `session` and `remember` are opt-in. */
export async function askMain(ctx: AskCtx, header: string, body: string, opts: MainOpts = {}): Promise<MainChoice> {
	const choices: Array<{ label: string; value: MainChoice }> = [];
	if (opts.allowFirst && opts.once !== false) choices.push({ label: "Allow (default)", value: "once" });
	choices.push({ label: opts.allowFirst ? "Deny" : "Block (default)", value: "block" });
	if (!opts.allowFirst && opts.once !== false) choices.push({ label: "Allow once", value: "once" });
	if (opts.session) choices.push({ label: "Allow for this session", value: "session" });
	if (opts.remember !== false) choices.push({ label: "Allow and remember…", value: "remember" });
	const { picked, expired } = await askSelect(ctx, `${header}\n${body}`, choices.map((c) => c.label), opts.timeoutMs);
	if (expired && opts.allowFirst) return "once";
	return choices.find((c) => c.label === picked)?.value ?? "block";
}

export type ScopeChoice = { scope: "cwd" | "global"; folder: boolean };

/** Screen 2 for a file/folder subject. `folderPath === null` hides the folder grants. */
export async function askRememberFile(
	ctx: AskCtx,
	title: string,
	body: string,
	filePath: string,
	folderPath: string | null,
): Promise<ScopeChoice | null> {
	const choices: Array<{ label: string; value: ScopeChoice }> = [
		{ label: `Allow for this file (${filePath}) - Scope this project`, value: { scope: "cwd", folder: false } },
	];
	if (folderPath) choices.push({ label: `Allow for this folder (${folderPath}) - Scope this project`, value: { scope: "cwd", folder: true } });
	choices.push({ label: `Allow for this file (${filePath}) - Scope global`, value: { scope: "global", folder: false } });
	if (folderPath) choices.push({ label: `Allow for this folder (${folderPath}) - Scope global`, value: { scope: "global", folder: true } });
	const { picked } = await askSelect(ctx, `${title}\n${body}`, choices.map((c) => c.label));
	return choices.find((c) => c.label === picked)?.value ?? null;
}

/** Screen 2 for a domain subject (no file/folder). */
export async function askRememberHost(
	ctx: AskCtx,
	title: string,
	body: string,
	host: string,
): Promise<{ scope: "cwd" | "global" } | null> {
	const choices: Array<{ label: string; value: { scope: "cwd" | "global" } }> = [
		{ label: `Allow for this host (${host}) - Scope this project`, value: { scope: "cwd" } },
		{ label: `Allow for this host (${host}) - Scope global`, value: { scope: "global" } },
	];
	const { picked } = await askSelect(ctx, `${title}\n${body}`, choices.map((c) => c.label));
	return choices.find((c) => c.label === picked)?.value ?? null;
}

export type ExposureChoice = "allow" | "block";

/** Advanced Secure output gate (ADR-018): show where it was found and ask before the output reaches the model. */
export async function askExposure(ctx: AskCtx, hits: string[]): Promise<ExposureChoice> {
	const choices: Array<{ label: string; value: ExposureChoice }> = [
		{ label: "No, keep private", value: "block" },
		{ label: "Yes, allow", value: "allow" },
	];
	const title = ["⚠ Sensitive information detected", "", hits.join("\n\n"), "", "Should the AI be allowed to see it?"].join("\n");
	const { picked } = await askSelect(ctx, title, choices.map((c) => c.label));
	return choices.find((c) => c.label === picked)?.value ?? "block";
}

/**
 * The model-facing notice when Advanced Secure withholds output. Never empty
 * and never phrased as a failure, so the model treats it as a deliberate block
 * by the user, not a broken tool or an empty result.
 */
export function withheldNotice(subject: string): string {
	return [
		`⚠ Output from \`${subject}\` was withheld because it may contain sensitive information.`,
		"",
		"The tool completed successfully, but the output is unavailable.",
		"Continue with the available information, or ask the user to allow access if the output is needed.",
	].join("\n");
}
