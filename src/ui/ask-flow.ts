/**
 * Shared ask-tier UI primitives for both layers. Pure: no pi, no OS, no fs —
 * it only calls the caller's `ctx.ui.select`, so the contract tests can script it.
 *
 * Screen 1: a short verdict + `Block (default)` / `Allow once` /
 *   `Allow for this session` / `Allow and remember…` (each optional per caller).
 * Screen 2: only after "remember" — `Allow for this file|folder (<path>) -
 *   Scope this project|global`. Esc / timeout on either screen blocks.
 */

export type AskCtx = {
	hasUI?: boolean;
	ui: {
		select: (t: string, o: string[], op?: { timeout?: number }) => Promise<string | undefined>;
	};
};

export type MainChoice = "block" | "once" | "session" | "remember";

/** How long a pending permission prompt waits before it resolves to the safe default (block / deny). */
export const ASK_TIMEOUT_MS = 10_000;

/** Screen 1. `once` defaults on; `session` and `remember` are opt-in. */
export async function askMain(
	ctx: AskCtx,
	header: string,
	body: string,
	opts: { once?: boolean; session?: boolean; remember?: boolean } = {},
): Promise<MainChoice> {
	const choices: Array<{ label: string; value: MainChoice }> = [
		{ label: "Block (default)", value: "block" },
	];
	if (opts.once !== false) choices.push({ label: "Allow once", value: "once" });
	if (opts.session) choices.push({ label: "Allow for this session", value: "session" });
	if (opts.remember !== false) choices.push({ label: "Allow and remember…", value: "remember" });
	const picked = await ctx.ui.select(`${header}\n${body}`, choices.map((c) => c.label), { timeout: ASK_TIMEOUT_MS });
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
	const picked = await ctx.ui.select(`${title}\n${body}`, choices.map((c) => c.label), { timeout: ASK_TIMEOUT_MS });
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
	const picked = await ctx.ui.select(`${title}\n${body}`, choices.map((c) => c.label), { timeout: ASK_TIMEOUT_MS });
	return choices.find((c) => c.label === picked)?.value ?? null;
}

export type ExposureChoice = "allow" | "block";

/** Advanced Secure output gate (ADR-018): ask before a secret-looking output reaches the model. */
export async function askExposure(ctx: AskCtx, findings: string[]): Promise<ExposureChoice> {
	const choices: Array<{ label: string; value: ExposureChoice }> = [
		{ label: "No, keep private (default)", value: "block" },
		{ label: "Yes, share", value: "allow" },
	];
	const title =
		"--- ⚠ Sensitive information detected\n" +
		`   ${findings.join(", ")}\n\n` +
		"This information is private. Do you want to share it?";
	const picked = await ctx.ui.select(title, choices.map((c) => c.label), { timeout: ASK_TIMEOUT_MS });
	return choices.find((c) => c.label === picked)?.value ?? "block";
}

/**
 * The model-facing notice when Advanced Secure withholds output. Never empty
 * and never phrased as a failure, so the model treats it as a deliberate block
 * by the user, not a broken tool or an empty result.
 */
export function withheldNotice(tool: string, findings: string[]): string {
	return [
		`[🛡 Advanced Secure] Output withheld — the user blocked ${tool} output because it may contain sensitive information (${findings.join(", ")}).`,
		"This is a deliberate policy block by the user, not a tool failure and not an empty result.",
		"The tool ran; only its output was withheld. Do not retry the same call or guess the hidden values.",
		"Tell the user you cannot see the output and ask how they want to proceed.",
	].join("\n");
}
