/**
 * Permission-mode UI (ADR-018): `/permission-mode` and the persisted mode.
 * Enforces nothing; persists `mode` to the global sandbox.json. The mode is
 * reflected in the single sandbox footer chip as an icon: `☢️`
 * advanced-secure, `🛡️` default.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { modeLabel, normalizeMode, setPolicyMode, type PermissionMode } from "../src/core/index";
import { loadConfig } from "../src/l1-sandbox/config";
import { loadPolicy } from "../src/l2-guard/policy";
import { audit } from "../src/shared/audit";

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

/**
 * The single sandbox footer chip: `Sandbox: <icon> N domains, M paths`.
 * `☢️` marks advanced-secure, `🛡️` default. Skipped when layers are disabled
 * (YOLO) or the sandbox is off, so it never clobbers those notices.
 */
function renderSandboxChip(pi: ExtensionAPI, ctx: ExtensionContext): void {
	if (pi.getFlag("yolo") || pi.getFlag("no-sandbox")) return;
	const config = loadConfig(ctx.cwd);
	if (!config.enabled) return;
	const secure = config.mode === "advanced-secure";
	const domains = config.network?.allowedDomains?.length ?? 0;
	const paths = config.filesystem?.allowWrite?.length ?? 0;
	const text = `Sandbox: ${secure ? "☢️" : "🛡️"}\u2002${domains} domains, ${paths} paths`;
	ctx.ui.setStatus("sandbox", ctx.ui.theme.fg(secure ? "success" : "accent", text));
}

async function pickMode(ctx: ExtensionContext, renderChip: (ctx: ExtensionContext) => void): Promise<void> {
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
	audit({ layer: 0, event: "permission-mode", mode: next, cwd: ctx.cwd });
	renderChip(ctx);
	ctx.ui.notify(
		next === "advanced-secure"
			? "🛡 Advanced Secure on. File reads, MCP calls, and tool output are checked for secrets."
			: "🛡 Default mode. Rule-based policy only.",
		"info",
	);
}

export default function (pi: ExtensionAPI) {
	const renderChip = (ctx: ExtensionContext) => renderSandboxChip(pi, ctx);

	pi.registerCommand?.("permission-mode", {
		description: "Choose the permission mode: Default (rules) or Advanced Secure (secret/credential detection).",
		handler: async (_args, ctx) => pickMode(ctx, renderChip),
	});
}
