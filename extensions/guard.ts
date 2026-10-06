/**
 * Pi Security Guard — Layer 2 entrypoint (thin pi wiring).
 *
 * Hooks `tool_call` for the in-process tools that bash sandbox can't reach
 * (`read`, `grep`, `find`, `ls`, `write`, `edit`, `fetch_content`,
 * `web_search`, `get_search_content`) and applies the same policy file as
 * the bash sandbox. Hooks `tool_result` to drop grep output lines from denied
 * files beneath an allowed search root.
 *
 * Layer 3 (subagent posture) is folded in: when `ctx.hasUI === false` we
 * (a) never prompt, always block on ambiguity, and (b) drop network unless
 * the running agent is in the small research allowlist.
 *
 * All logic lives in `src/l2-guard/`:
 *  - `policy.ts`    policy shape, defaults, loading, project trust
 *  - `matching.ts`  path matching, absolute-deny tier, outside-project boundary
 *  - `url.ts`       domain allow/deny matching
 *  - `prompts.ts`   ask-tier prompts, session grants, persisted overrides
 *  - `subagent.ts`  Layer 3 posture
 *  - `audit.ts`     audit log
 * The pure policy logic is in `src/core/`.
 *
 * Disabled by `--yolo` (single global escape hatch shared with Layer 1).
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType, getAgentDir } from "@earendil-works/pi-coding-agent";
import { filterGrepOutput, policyFileError, forgetProjectTrust, isProjectFileDeclined, recordProjectDeclined, recordProjectTrust } from "../src/core/index";
import { classifyFilename, evaluateMcpCall, scanToolOutput, type JsonSchemaLike, type McpToolAnnotations } from "../src/detect";
import { askExposure, askMain, withheldNotice } from "../src/ui/ask-flow";
import { loadPolicy, projectPolicyPath, projectTrusted, setPiDeclinedTrust, untrustedProjectChanges, bullets, TRUST_STORE } from "../src/l2-guard/policy";
import { canonicalize, expandHome, isAbsoluteDeny, isDeniedRead, isDeniedWrite, outsideProjectReason } from "../src/l2-guard/matching";
import { hostnameOf, isAllowedUrl } from "../src/l2-guard/url";
import { audit, AUDIT_PATH } from "../src/l2-guard/audit";
import { askOrBlock, clearSessionGrants, sessionGrantSummary, type UICtx } from "../src/l2-guard/prompts";
import { denyMessage } from "../src/l2-guard/ask";
import { subagentNetworkBlock } from "../src/l2-guard/subagent";

/**
 * Advanced Secure (ADR-018): detection-based asks and output redaction.
 * Detection may only ADD asks or redactions; it never loosens a rule. Session
 * grants are in memory only, exactly like the path grants.
 */
const detectionGrants = new Set<string>();

function detectionBlock(action: "read" | "tool", why: string): string {
	if (action === "read") return `Read blocked by policy: ${why}. Nothing was read — ask the user.`;
	return `Tool call blocked by policy: ${why}. Nothing was run — ask the user.`;
}

async function askDetection(
	ctx: UICtx,
	kind: "read" | "tool",
	subject: string,
	reason: string,
): Promise<{ block: true; reason: string } | null> {
	const key = `${kind}:${subject}`;
	if (detectionGrants.has(key)) return null;
	if (ctx.hasUI === false) {
		audit({ layer: 2, tool: kind, subject, reason, decision: "no", note: "advanced-secure-headless", cwd: ctx.cwd });
		return { block: true, reason: detectionBlock(kind, reason) };
	}
	const header = kind === "read" ? "Read blocked — sensitive file" : "Tool call blocked — risky";
	const body = `  ${kind === "read" ? "file" : "tool"}:  ${subject}\n  why:   ${reason}`;
	const choice = await askMain(ctx, header, body, { session: true, remember: false });
	if (choice === "once") {
		audit({ layer: 2, tool: kind, subject, reason, decision: "yes", note: "advanced-secure", cwd: ctx.cwd });
		return null;
	}
	if (choice === "session") {
		detectionGrants.add(key);
		audit({ layer: 2, tool: kind, subject, reason, decision: "session", note: "advanced-secure", cwd: ctx.cwd });
		ctx.ui.notify(`security-guard: allowed for this session (not saved) → ${subject}`, "info");
		return null;
	}
	audit({ layer: 2, tool: kind, subject, reason, decision: "no", note: "advanced-secure", cwd: ctx.cwd });
	return { block: true, reason: detectionBlock(kind, reason) };
}

async function detectMcpAsk(
	pi: ExtensionAPI,
	toolName: string,
	input: Record<string, unknown>,
	ctx: UICtx,
): Promise<{ block: true; reason: string } | null> {
	const info = pi.getAllTools().find((t) => t.name === toolName);
	const result = evaluateMcpCall({
		tool: {
			name: toolName,
			description: info?.description,
			inputSchema: /* SAFETY: ToolInfo.parameters is a JSON Schema; JsonSchemaLike is its structural subset. */ info?.parameters as JsonSchemaLike | undefined,
			annotations: /* SAFETY: pi's ToolAnnotations mirrors the MCP hints McpToolAnnotations names. */ info?.annotations as McpToolAnnotations | undefined,
		},
		call: { name: toolName, arguments: input },
	});
	if (result.decision !== "ask") return null;
	return askDetection(ctx, "tool", toolName, result.summary);
}

export default function (pi: ExtensionAPI) {
	let active = false;

	pi.on("session_start", (_event, ctx) => {
		const yolo = (pi.getFlag?.("yolo") as boolean) || (pi.getFlag?.("no-sandbox") as boolean);
		if (yolo) {
			active = false;
			ctx.ui.notify("⚠️  security-guard (Layer 2) disabled: --yolo", "warning");
			return;
		}
		// A policy file that does not parse is skipped and the defaults apply.
		// Say so loudly: otherwise one trailing comma silently disables the whole file.
		for (const p of [`${getAgentDir()}/extensions/sandbox.json`, `${ctx.cwd}/.pi/sandbox.json`]) {
			const err = policyFileError(p);
			if (!err) continue;
			audit({ layer: 2, event: "policy-parse-error", file: p, error: err, cwd: ctx.cwd });
			console.error(`security-guard: ${p} does not parse (${err}); its rules are NOT applied`);
			ctx.ui.notify(`⚠️  security-guard: ${p} does not parse, so neither layer applies its rules (built-in defaults instead).\n${err}`, "error");
		}
		setPiDeclinedTrust((ctx as { isProjectTrusted?: () => boolean }).isProjectTrusted?.() === false);
		const changes = untrustedProjectChanges(ctx.cwd);
		if (changes.length && !isProjectFileDeclined(projectPolicyPath(ctx.cwd), TRUST_STORE)) {
			audit({ layer: 2, event: "untrusted-project-policy", file: projectPolicyPath(ctx.cwd), changes, cwd: ctx.cwd });
			ctx.ui.notify(
				`⚠️  This folder has a .pi/sandbox.json that tries to make your security weaker:\n${bullets(changes)}\n` +
					"auto-permission-system ignores these changes. Its block rules still apply.\n" +
					"Did you write this file? Then type /security trust.",
				"warning",
			);
		}
		const policy = loadPolicy(ctx.cwd);
		if (!policy.enabled) {
			active = false;
			ctx.ui.notify("security-guard (Layer 2) disabled: enabled=false in sandbox.json", "info");
			return;
		}
		active = true;
		clearSessionGrants();
		detectionGrants.clear();
		ctx.ui.notify("🔒 security-guard (Layer 2) active", "info");
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!active) return;
		const policy = loadPolicy(ctx.cwd);

		// --- Path-based gates (with ask-tier prompt) ---
		// One gate for every read: the read policy first, then the project boundary.
		const gateRead = async (rawPath: string, tool: string) => {
			const abs = canonicalize(rawPath, ctx.cwd);
			let reason = isDeniedRead(rawPath, ctx.cwd, policy);
			let outside = false;
			if (!reason) {
				reason = outsideProjectReason(abs, ctx.cwd, policy);
				outside = reason !== null;
			}
			if (!reason) return undefined;
			if (outside && policy.filesystem.outsideProject?.read === "deny") {
				audit({ layer: 2, tool, subject: abs, reason, decision: "no", note: "outside-project-deny", cwd: ctx.cwd });
				return { block: true as const, reason: denyMessage("allowRead", reason) };
			}
			const e = expandHome(rawPath);
			const spelled = isAbsolute(e) ? e : resolve(ctx.cwd, e);
			const result = await askOrBlock(/* SAFETY: pi's ctx carries cwd/UI at runtime; local UICtx names the members used. */ ctx as unknown as UICtx, { layer: 2, tool, subject: abs, reason, overrideKind: "allowRead", overrideValue: abs, outside, spelled }, isAbsoluteDeny(abs, ctx.cwd));
			return result ?? undefined;
		};
		if (isToolCallEventType("read", event)) {
			const result = await gateRead(event.input.path, "read");
			if (result) return result;
			if (policy.mode === "advanced-secure") {
				const abs = canonicalize(event.input.path, ctx.cwd);
				const verdict = classifyFilename(abs);
				if (verdict.risk === "strong") {
					const det = await askDetection(/* SAFETY: pi's ctx carries cwd/UI at runtime. */ ctx as unknown as UICtx, "read", abs, verdict.reasons[0] ?? "sensitive filename");
					if (det) return det;
				}
			}
		}
		// Read-only search tools. grep returns file contents and runs ripgrep in
		// process, so neither the bash sandbox nor the read gate saw it before.
		// Gate the search root here; tool_result below drops output lines from
		// denied files beneath the root.
		const searchRoot = isToolCallEventType("grep", event) || isToolCallEventType("find", event) || isToolCallEventType("ls", event)
			? (event.input.path ?? ".")
			: null;
		if (searchRoot !== null) {
			const result = await gateRead(searchRoot, event.toolName);
			if (result) return result;
		}
		if (isToolCallEventType("write", event)) {
			const reason = isDeniedWrite(event.input.path, ctx.cwd, policy);
			if (reason) {
				const abs = canonicalize(event.input.path, ctx.cwd);
				const result = await askOrBlock(/* SAFETY: pi's ctx carries cwd/UI at runtime. */ ctx as unknown as UICtx, { layer: 2, tool: "write", subject: abs, reason, overrideKind: "allowWrite", overrideValue: abs }, isAbsoluteDeny(abs, ctx.cwd));
				if (result) return result;
			}
		}
		if (isToolCallEventType("edit", event)) {
			const reason = isDeniedWrite(event.input.path, ctx.cwd, policy);
			if (reason) {
				const abs = canonicalize(event.input.path, ctx.cwd);
				const result = await askOrBlock(/* SAFETY: pi's ctx carries cwd/UI at runtime. */ ctx as unknown as UICtx, { layer: 2, tool: "edit", subject: abs, reason, overrideKind: "allowWrite", overrideValue: abs }, isAbsoluteDeny(abs, ctx.cwd));
				if (result) return result;
			}
		}

		// --- URL/domain gates (best-effort by tool name; tools are extension-defined) ---
		const input = event.input as Record<string, unknown> | undefined;
		const collectUrls = (): string[] => {
			if (!input) return [];
			const urls: string[] = [];
			if (typeof input.url === "string") urls.push(input.url);
			if (Array.isArray(input.urls)) {
				for (const u of input.urls) if (typeof u === "string") urls.push(u);
			}
			return urls;
		};

		if (event.toolName === "fetch_content" || event.toolName === "get_search_content") {
			const saReason = subagentNetworkBlock(ctx as { hasUI?: boolean; sessionManager?: unknown }, policy);
			if (saReason) return { block: true, reason: saReason };
			for (const u of collectUrls()) {
				const reason = isAllowedUrl(u, policy);
				if (!reason) continue;
				const host = hostnameOf(u) ?? u;
				const result = await askOrBlock(/* SAFETY: pi's ctx carries cwd/UI at runtime. */ ctx as unknown as UICtx, { layer: 2, tool: event.toolName, subject: u, reason, overrideKind: "allowDomains", overrideValue: host }, null);
				if (result) return result;
			}
		}

		if (event.toolName === "web_search") {
			const saReason = subagentNetworkBlock(ctx as { hasUI?: boolean; sessionManager?: unknown }, policy);
			if (saReason) return { block: true, reason: saReason };
			// web_search itself goes to the search provider (out of scope for v1
			// allowlist). The follow-on fetch_content for individual results is
			// the catchable surface.
		}

		// Advanced Secure (ADR-018): classify MCP tool calls before they run.
		if (policy.mode === "advanced-secure" && event.toolName.startsWith("mcp__")) {
			const det = await detectMcpAsk(pi, event.toolName, (event.input ?? {}) as Record<string, unknown>, /* SAFETY: pi's ctx carries cwd/UI at runtime. */ ctx as unknown as UICtx);
			if (det) return det;
		}
	});

	// grep output filter. A root that passed the gate can still contain denied
	// files (`.env`, `*.pem`, `~/.ssh` under a search of `~`). Approving the
	// root does not approve the denied files beneath it. Runs before the
	// result reaches the model.
	pi.on("tool_result", (event, ctx) => {
		if (!active || event.toolName !== "grep" || event.isError) return;
		const input = event.input as { path?: string } | undefined;
		const policy = loadPolicy(ctx.cwd);
		const root = canonicalize(input?.path ?? ".", ctx.cwd);
		let rootIsDir = false;
		try {
			rootIsDir = statSync(root).isDirectory();
		} catch {
			return;
		}
		// A single-file search prints only the basename; its root gate already decided.
		if (!rootIsDir) return;
		let removedLines = 0;
		const removedFiles = new Set<string>();
		const content = event.content.map((c) => {
			if (c.type !== "text") return c;
			const r = filterGrepOutput(c.text, (printed) => isDeniedRead(join(root, printed), ctx.cwd, policy) !== null);
			removedLines += r.removedLines;
			for (const f of r.removedFiles) removedFiles.add(f);
			return { ...c, text: r.text };
		});
		if (removedLines === 0) return;
		audit({ layer: 2, tool: "grep", subject: root, decision: "redacted", removedLines, removedFiles: [...removedFiles], cwd: ctx.cwd });
		content.push({ type: "text", text: `\n[security-guard: removed ${removedLines} line(s) from ${removedFiles.size} file(s) that match the read-deny policy]` });
		return { content };
	});

	// Advanced Secure (ADR-018): before any tool output reaches the model, ask
	// the user when it looks like it carries a secret. Block withholds it and
	// tells the model plainly, so the model does not read it as a failure or an
	// empty result; Allow send passes the real values through.
	pi.on("tool_result", async (event, ctx) => {
		if (!active || event.isError) return;
		const policy = loadPolicy(ctx.cwd);
		if (policy.mode !== "advanced-secure") return;
		const types = new Set<string>();
		const lines: string[] = [];
		for (const c of event.content) {
			if (c.type !== "text") continue;
			const r = scanToolOutput({ output: c.text });
			if (r.decision !== "ask") continue;
			for (const f of r.findings) types.add(f.type);
			const before = c.text.split("\n");
			const after = String(r.redactedOutput ?? "").split("\n");
			for (let i = 0; i < before.length && lines.length < 8; i++) {
				if (after[i] !== before[i] && before[i].trim()) lines.push(before[i].trim());
			}
		}
		if (!types.size) return;
		const findings = [...types];
		const ui = /* SAFETY: pi's ctx carries cwd/UI at runtime; the local type only names the members used. */ ctx as unknown as UICtx;
		const allow = ui.hasUI !== false && (await askExposure(ui, findings, lines)) === "allow";
		if (allow) {
			audit({ layer: 2, tool: event.toolName, decision: "yes", note: "advanced-secure-output", findings, cwd: ctx.cwd });
			ctx.ui.notify(`🛡 Advanced Secure: you allowed ${event.toolName} output to be sent (${findings.join(", ")}).`, "warning");
			return;
		}
		audit({ layer: 2, tool: event.toolName, decision: "no", note: "advanced-secure-output", findings, cwd: ctx.cwd });
		const input = event.input ?? {};
		const rawPath = input.path ?? input.file_path;
		const subject = typeof rawPath === "string" && rawPath ? rawPath : event.toolName;
		ctx.ui.notify(`🛡 Advanced Secure: blocked ${event.toolName} output — it may contain ${findings.join(", ")}. Nothing was sent to the model.`, "warning");
		return { content: [{ type: "text", text: withheldNotice(subject) }] };
	});

	pi.registerCommand?.("security", {
		description: "Show Layer 2 policy and status. /security trust | untrust: trust this project's .pi/sandbox.json as it is now, or stop trusting it",
		handler: async (args, ctx) => {
			const sub = String(args ?? "").trim();
			const file = projectPolicyPath(ctx.cwd);
			if (sub === "trust" || sub === "untrust") {
				if (!existsSync(file)) {
					ctx.ui.notify("This folder has no .pi/sandbox.json.", "info");
					return;
				}
				if (sub === "untrust") {
					forgetProjectTrust(file, TRUST_STORE);
					audit({ layer: 2, event: "project-untrusted", file, cwd: ctx.cwd });
					ctx.ui.notify("OK. The file is not trusted now. Only its block rules apply.", "info");
					return;
				}
				if (projectTrusted(ctx.cwd)) {
					ctx.ui.notify("This file is already trusted.", "info");
					return;
				}
				const changes = untrustedProjectChanges(ctx.cwd);
				if (!changes.length) {
					ctx.ui.notify("This file only adds block rules. They apply already. You do not have to trust it.", "info");
					return;
				}
				const options = ["No — ignore these changes (default)", "Yes — I wrote this file. Apply it."];
				const title = `Do you trust this file?\n${file}\n\nIt will:\n${bullets(changes)}\n\nIf the file changes, auto-permission-system asks again.`;
				const chosen = await ctx.ui.select(title, options, { timeout: 120_000 });
				if (chosen !== options[1]) {
					recordProjectDeclined(file, TRUST_STORE);
					audit({ layer: 2, event: "project-trust-declined", file, changes, cwd: ctx.cwd });
					ctx.ui.notify("OK. auto-permission-system ignores these changes. It does not ask again until the file changes.", "info");
					return;
				}
				recordProjectTrust(file, TRUST_STORE);
				audit({ layer: 2, event: "project-trusted", file, applied: changes, cwd: ctx.cwd });
				ctx.ui.notify("Done. The file applies now. Start a new session so the bash sandbox uses it too.", "info");
				return;
			}
			if (!active) {
				ctx.ui.notify("security-guard: inactive (yolo or disabled)", "info");
				return;
			}
			const policy = loadPolicy(ctx.cwd);
			const overrides = policy.overrides ?? {};
			const lines = [
				"Security Guard (Layer 2):",
				"",
				`  cwd:               ${ctx.cwd}`,
				`  hasUI:             ${(ctx as { hasUI?: boolean }).hasUI !== false}`,
				`  subagent.network:  ${policy.subagent?.network ?? "allow"}`,
				`  session grants:    ${sessionGrantSummary() || "(none)"}`,
				`  project file:      ${!existsSync(projectPolicyPath(ctx.cwd)) ? "none" : projectTrusted(ctx.cwd) ? "trusted" : untrustedProjectChanges(ctx.cwd).length ? `not trusted, its weaker settings are ignored (/security trust)` : "only block rules, they apply"}`,
				`  outside project:   read ${policy.filesystem.outsideProject?.read ?? "allow"}${(policy.filesystem.outsideProject?.allowRead ?? []).length ? `, allowRead ${policy.filesystem.outsideProject?.allowRead?.join(", ")}` : ""}`,
				"",
				"Filesystem:",
				`  denyRead:    ${policy.filesystem.denyRead.join(", ") || "(none)"}`,
				`  allowWrite:  ${policy.filesystem.allowWrite.join(", ") || "(none)"}`,
				`  denyWrite:   ${policy.filesystem.denyWrite.join(", ") || "(none)"}`,
				"",
				"Network (URL tools):",
				`  allowed:     ${policy.network.allowedDomains.join(", ") || "(none)"}`,
				`  denied:      ${policy.network.deniedDomains.join(", ") || "(none)"}`,
				"",
				"Project-local overrides (<cwd>/.pi/sandbox.json `overrides`):",
				`  allowRead:    ${(overrides.allowRead ?? []).join(", ") || "(none)"}`,
				`  allowWrite:   ${(overrides.allowWrite ?? []).join(", ") || "(none)"}`,
				`  allowDomains: ${(overrides.allowDomains ?? []).join(", ") || "(none)"}`,
			];
			try {
				const tail = readFileSync(AUDIT_PATH, "utf-8").trim().split("\n").slice(-10);
				if (tail.length && tail[0]) {
					lines.push("", "Recent audit (last 10):");
					for (const l of tail) lines.push(`  ${l}`);
				}
			} catch {
				/* no audit log yet */
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
