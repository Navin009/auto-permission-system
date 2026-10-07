/**
 * Permission-mode UI (ADR-018, ADR-020): `/permission-mode` and the persisted mode.
 * Enforces nothing; persists `mode` to the global sandbox.json. The mode is
 * reflected in the single sandbox footer chip as an icon: `🔐`
 * advanced-secure, `🔒` default, `⚠️` YOLO.
 *
 * All three modes are persisted the same way and are one menu pick. YOLO is the
 * weakest tier: every layer is off. It travels to the layers over pi's event bus
 * (`src/shared/yolo.ts`) so the switch takes effect without a restart.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { modeLabel, normalizeMode, setPolicyMode, type PermissionMode } from "../src/core/index";
import { loadConfig } from "../src/l1-sandbox/config";
import { loadPolicy } from "../src/l2-guard/policy";
import { audit } from "../src/shared/audit";
import { emitYolo, onYolo, YOLO_STATUS } from "../src/shared/yolo";

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
	{
		label: "YOLO — disable ALL security layers",
		value: "yolo",
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
	"",
	"YOLO",
	"  Turns every layer off. Saved like the other modes, so new sessions",
	"  start with it too until you pick Default or Advanced Secure again.",
].join("\n");

/**
 * The single sandbox footer chip: `Sandbox: <icon> N domains, M paths`.
 * `🔐` marks advanced-secure, `🔒` default; YOLO replaces it with the warning.
 * Both sandbox icons are single-code-point emoji (no U+FE0F variation selector),
 * so every terminal measures them as two cells and the padding stays even.
 * Skipped when the sandbox is off, so it never clobbers those notices.
 */
function renderSandboxChip(ctx: ExtensionContext): void {
	const config = loadConfig(ctx.cwd);
	if (normalizeMode(config.mode) === "yolo") {
		ctx.ui.setStatus("sandbox", ctx.ui.theme.fg("error", YOLO_STATUS));
		return;
	}
	if (!config.enabled) return;
	const secure = config.mode === "advanced-secure";
	const domains = config.network?.allowedDomains?.length ?? 0;
	const paths = config.filesystem?.allowWrite?.length ?? 0;
	const text = `Sandbox: ${secure ? "🔐" : "🔒"}  ${domains} domains, ${paths} paths`;
	ctx.ui.setStatus("sandbox", ctx.ui.theme.fg(secure ? "success" : "accent", text));
}

function modeNotice(mode: PermissionMode): { text: string; level: "info" | "warning" } {
	if (mode === "yolo") return { text: "⚠️  YOLO — all security layers disabled. Saved; new sessions start this way too.", level: "warning" };
	if (mode === "advanced-secure") return { text: "🛡 Advanced Secure on. File reads, MCP calls, and tool output are checked for secrets.", level: "info" };
	return { text: "🛡 Default mode. Rule-based policy only.", level: "info" };
}

async function pickMode(pi: ExtensionAPI, ctx: ExtensionContext, yolo: { active: boolean }): Promise<void> {
	const current: PermissionMode = yolo.active ? "yolo" : normalizeMode(loadPolicy(ctx.cwd).mode);
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
	yolo.active = next === "yolo";
	// Layers off/on in place, without a restart. `--yolo` keeps its own flag
	// value; this only flips the runtime state.
	emitYolo(pi.events, yolo.active);
	audit({ layer: 0, event: "permission-mode", mode: next, cwd: ctx.cwd });
	renderSandboxChip(ctx);
	const notice = modeNotice(next);
	ctx.ui.notify(notice.text, notice.level);
}

export default function (pi: ExtensionAPI) {
	const yolo = { active: false };
	// `sandbox.ts` owns the CLI flags and broadcasts the startup state, so the
	// menu shows the truth even when `--yolo` was passed for this run only.
	onYolo(pi.events, (enabled) => {
		yolo.active = enabled;
	});

	pi.registerCommand?.("permission-mode", {
		description: "Choose the permission mode: Default (rules), Advanced Secure (detection), or YOLO (all layers off). Saved to the global sandbox.json.",
		handler: async (_args, ctx) => pickMode(pi, ctx, yolo),
	});
}
