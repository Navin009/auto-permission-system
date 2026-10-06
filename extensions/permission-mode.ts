/**
 * Permission-mode UI — a small third entrypoint (ADR-018).
 *
 * Owns the one footer status, `/permission-mode`, and the Shift+S shortcut.
 * It enforces nothing: both layers read `mode` from the merged sandbox.json and
 * act on it. The choice is persisted to the global
 * `~/.pi/agent/extensions/sandbox.json` so Layer 1 and Layer 2 — separate
 * entrypoints with no shared memory — both pick it up (Layer 2 at once, Layer 1
 * on its next session_start).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { modeLabel, normalizeMode, setPolicyMode, type PermissionMode } from "../src/core/index";
import { loadPolicy } from "../src/l2-guard/policy";
import { audit } from "../src/l2-guard/audit";

const GLOBAL_POLICY = `${getAgentDir()}/extensions/sandbox.json`;

const MODES: Array<{ label: string; value: PermissionMode }> = [
	{
		label: "Default — rules only (recommended)",
		value: "default",
	},
	{
		label: "Advanced Secure — detect secrets in reads, MCP calls, and output",
		value: "advanced-secure",
	},
];

const EXPLANATION = [
	"Default (recommended)",
	"  Rule-based only: sandbox.json paths, domains, and commands.",
	"  No file contents are inspected.",
	"",
	"Advanced Secure",
	"  Adds secret/credential detection on top of the rules:",
	"   • File reads — scans contents for keys, tokens, and passwords",
	"   • MCP calls — flags risky tool calls before they run",
	"   • Tool/command/file output — redacts secrets before they reach the model",
].join("\n");

function renderStatus(ctx: ExtensionContext, mode: PermissionMode): void {
	const text = `🛡 ${modeLabel(mode)} (Shift+S)`;
	ctx.ui.setStatus("permission-mode", ctx.ui.theme.fg(mode === "advanced-secure" ? "success" : "accent", text));
}

async function pickMode(ctx: ExtensionContext): Promise<void> {
	const current = normalizeMode(loadPolicy(ctx.cwd).mode);
	const picked = await ctx.ui.select(
		`Permission mode — current: ${modeLabel(current)}\n\n${EXPLANATION}\n\nEsc keeps the current mode.`,
		MODES.map((m) => m.label),
		{ timeout: 120_000 },
	);
	if (picked === undefined) return; // Esc / timeout → keep the current mode
	const next = MODES.find((m) => m.label === picked)?.value ?? current;
	if (next === current) {
		ctx.ui.notify(`Permission mode is already ${modeLabel(next)}.`, "info");
		return;
	}
	try {
		setPolicyMode(GLOBAL_POLICY, next);
	} catch (e) {
		ctx.ui.notify(`Could not save the permission mode: ${e instanceof Error ? e.message : e}`, "error");
		return;
	}
	renderStatus(ctx, next);
	audit({ layer: 0, event: "permission-mode", mode: next, cwd: ctx.cwd });
	ctx.ui.notify(
		next === "advanced-secure"
			? "🛡 Advanced Secure on. File reads, MCP calls, and tool output are checked for secrets."
			: "🛡 Default mode. Rule-based policy only.",
		"info",
	);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		renderStatus(ctx, normalizeMode(loadPolicy(ctx.cwd).mode));
	});

	pi.registerCommand?.("permission-mode", {
		description: "Choose the permission mode: Default (rules) or Advanced Secure (secret/credential detection). Shift+S toggles it.",
		handler: async (_args, ctx) => pickMode(ctx),
	});

	pi.registerShortcut?.("shift+s", {
		description: "Change permission mode",
		handler: async (ctx) => pickMode(ctx),
	});
}
