/**
 * Permission-mode UI (ADR-018, ADR-020): `/permission-mode` and the persisted mode.
 * Enforces nothing; persists `mode` to the global sandbox.json. The mode is
 * reflected in the single sandbox footer chip as an icon: `🧠`
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

const MODE_DEFS: Array<{
	value: PermissionMode;
	icon: string;
	name: string;
	desc: string;
}> = [
	{
		value: "advanced-secure",
		icon: "🧠",
		name: "Advanced Secure",
		desc: "Blocks sensitive data leaks from file reads, MCP tools & command outputs",
	},
	{
		value: "default",
		icon: "🔒",
		name: "Default",
		desc: "Restricts file paths & network access at the sandbox level",
	},
	{
		value: "yolo",
		icon: "🚨",
		name: "YOLO",
		desc: "Turns off all file sandboxing and leak protections",
	},
];

/**
 * The single sandbox footer chip: `Sandbox: <icon> N domains, M paths`.
 * `🧠` marks advanced-secure, `🔒` default; YOLO replaces it with the warning.
 * All three are single-code-point emoji (no U+FE0F variation selector), so
 * every terminal measures them as two cells and the padding stays even.
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
	const text = `Sandbox: ${secure ? "🧠" : "🔒"}  ${domains} domains, ${paths} paths`;
	ctx.ui.setStatus("sandbox", ctx.ui.theme.fg(secure ? "success" : "accent", text));
}

function modeNotice(mode: PermissionMode): { text: string; level: "info" | "warning" } {
	if (mode === "yolo") return { text: "🚨  YOLO — all security layers disabled. Saved; new conversations start this way too.", level: "warning" };
	if (mode === "advanced-secure") return { text: "🧠 Advanced Secure on. File reads, MCP calls, and tool output are checked for secrets.", level: "info" };
	return { text: "🛡 Default mode. Rule-based policy only.", level: "info" };
}

async function pickMode(pi: ExtensionAPI, ctx: ExtensionContext, yolo: { active: boolean }): Promise<void> {
	const current: PermissionMode = yolo.active ? "yolo" : normalizeMode(loadPolicy(ctx.cwd).mode);

	const options = MODE_DEFS.map((m) => {
		const isActive = m.value === current;
		const nameWithStatus = isActive ? `${m.name} (active)` : m.name;
		const labelCol = nameWithStatus.padEnd(26);
		return `${m.icon}  ${labelCol} —  ${m.desc}`;
	});

	const picked = await ctx.ui.select(
		"Select permission mode:",
		options,
		{ timeout: 120_000 },
	);
	if (picked === undefined) return;

	const pickedIndex = options.indexOf(picked);
	const next = pickedIndex >= 0 ? MODE_DEFS[pickedIndex].value : current;
	if (next === current) {
		if (next === "yolo" && !yolo.active) {
			yolo.active = true;
			emitYolo(pi.events, true);
			audit({ layer: 0, event: "permission-mode", mode: "yolo", cwd: ctx.cwd, note: "runtime-sync" });
			renderSandboxChip(ctx);
			ctx.ui.notify("🚨  YOLO — all security layers disabled for this conversation.", "warning");
			return;
		}
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
	emitYolo(pi.events, yolo.active);
	audit({ layer: 0, event: "permission-mode", mode: next, cwd: ctx.cwd });
	renderSandboxChip(ctx);
	const notice = modeNotice(next);
	ctx.ui.notify(notice.text, notice.level);
}

export default function (pi: ExtensionAPI) {
	const yolo = { active: false };
	onYolo(pi.events, (enabled) => {
		yolo.active = enabled;
	});

	pi.registerCommand?.("permission-mode", {
		description: "Choose the permission mode: Default (rules), Advanced Secure (detection), or YOLO (all layers off). Saved to the global sandbox.json.",
		handler: async (_args, ctx) => pickMode(pi, ctx, yolo),
	});
}
