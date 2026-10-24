/**
 * Pi Security Guard — Layer 2 entrypoint (thin pi wiring).
 *
 * Hooks `tool_call` for the in-process tools the bash sandbox can't reach, and
 * `tool_result` to filter grep output and (in Advanced Secure) gate secrets.
 * Logic lives in `src/l2-guard/` and `src/core/`. Disabled by `--yolo`.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType, getAgentDir } from "@earendil-works/pi-coding-agent";
import { filterGrepOutput, policyFileError, forgetProjectTrust, isProjectFileDeclined, recordProjectDeclined, recordProjectTrust } from "../src/core/index";
import { classifyFilename, evaluateMcpCall, type JsonSchemaLike, type McpPolicy, type McpToolAnnotations } from "../src/detect/index";
import { collectExposure } from "../src/l2-guard/exposure";
import { askExposure, askMain, withheldNotice } from "../src/ui/ask-flow";
import { loadPolicy, projectPolicyPath, projectTrusted, setPiDeclinedTrust, untrustedProjectChanges, bullets, TRUST_STORE } from "../src/l2-guard/policy";
import { canonicalize, expandHome, isAbsoluteDeny, isAskRead, isDeniedRead, isDeniedWrite, outsideProjectReason } from "../src/l2-guard/matching";
import { deniedUrlReason, hostnameOf, isAllowedUrl } from "../src/l2-guard/url";
import { audit, AUDIT_PATH } from "../src/shared/audit";
import { askOrBlock, clearSessionGrants, sessionGrantSummary, type UICtx } from "../src/l2-guard/prompts";
import { grantProgramOutputSession, isProgramOutputGranted, clearProgramOutputSessionGrants, programOutputSessionGrantSummary } from "../src/l2-guard/program-grants";
import { programIdForToolCall } from "../src/l2-guard/program-id";
import { denyMessage } from "../src/ui/ask";
import { emitDomainGrant } from "../src/shared/network-grants";
import { subagentNetworkBlock } from "../src/l2-guard/subagent";
import { onYolo } from "../src/shared/yolo";

/**
 * Advanced Secure (ADR-018): detection-based asks and output redaction.
 * Detection may only ADD asks or redactions; it never loosens a rule. Session
 * grants are in memory only, exactly like the path grants.
 */
const detectionGrants = new Set<string>();

function detectionBlock(action: "read" | "tool", why: string): string {
	if (action === "read") return `Read blocked by policy: ${why}. Nothing was read — ask the user to adjust the permission mode (/permission-mode) if needed. Do not attempt workarounds or inspect plugin files.`;
	return `Tool call blocked by policy: ${why}. Nothing was run — ask the user to adjust the permission mode (/permission-mode) if needed. Do not attempt workarounds or inspect plugin files.`;
}

/** Maps each in-flight tool call to the program id we'll show in the
 *  Advanced Secure output gate. Populated at `tool_call`, consumed at
 *  `tool_result`, cleared at `session_start`. */
const programIdByCallId = new Map<string, string>();

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
		ctx.ui.notify(`Allowed for this conversation: ${subject}`, "info");
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
	mcpPolicy?: McpPolicy,
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
		policy: mcpPolicy,
	});
	if (result.decision !== "ask") return null;

	// Include detailed call parameters or script preview if present
	let detailedSummary = result.summary;
	if (input && Object.keys(input).length > 0) {
		const rawScript = input.code ?? input.script ?? input.command ?? input.query;
		if (typeof rawScript === "string" && rawScript.includes("\n")) {
			detailedSummary += `\n\n${rawScript}`;
		} else {
			const formattedArgs = JSON.stringify(input, null, 2);
			if (formattedArgs.includes("\n")) {
				detailedSummary += `\n\nArguments:\n${formattedArgs}`;
			}
		}
	}

	return askDetection(ctx, "tool", toolName, detailedSummary);
}

export default function (pi: ExtensionAPI) {
	let active = false;
	let policyEnabled = false;
	let runtimeYolo = false;

	const applyActive = () => {
		active = policyEnabled && !runtimeYolo;
	};

	onYolo(pi.events, (enabled) => {
		runtimeYolo = enabled;
		applyActive();
		if (enabled) detectionGrants.clear();
	});

	pi.on("session_start", (_event, ctx) => {
		for (const p of [`${getAgentDir()}/extensions/sandbox.json`, `${ctx.cwd}/.pi/sandbox.json`]) {
			const err = policyFileError(p);
			if (!err) continue;
			audit({ layer: 2, event: "policy-parse-error", file: p, error: err, cwd: ctx.cwd });
			console.error(`security-guard: ${p} does not parse (${err}); its rules are NOT applied`);
			const isProject = p === `${ctx.cwd}/.pi/sandbox.json`;
			const msg = isProject
				? "⚠️  Syntax error in settings file — project configuration not loaded."
				: "⚠️  Syntax error in settings file — global configuration not loaded.";
			ctx.ui.notify(msg, "error");
		}
		setPiDeclinedTrust((ctx as { isProjectTrusted?: () => boolean }).isProjectTrusted?.() === false);
		const changes = untrustedProjectChanges(ctx.cwd);
		if (changes.length && !isProjectFileDeclined(projectPolicyPath(ctx.cwd), TRUST_STORE)) {
			audit({ layer: 2, event: "untrusted-project-policy", file: projectPolicyPath(ctx.cwd), changes, cwd: ctx.cwd });
			ctx.ui.notify("🛡️  Project-level configuration detected: run /security trust to approve.", "warning");
		}
		const policy = loadPolicy(ctx.cwd);
		if (!policy.enabled) {
			policyEnabled = false;
			applyActive();
			ctx.ui.notify("Tool guard is disabled in your sandbox.json settings.", "info");
			return;
		}
		policyEnabled = true;
		applyActive();
		clearSessionGrants();
		detectionGrants.clear();
		clearProgramOutputSessionGrants();
		programIdByCallId.clear();
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!active) return;
		const policy = loadPolicy(ctx.cwd);

		const programId = programIdForToolCall(event.toolName, event.input);
		if (event.toolCallId && programId) programIdByCallId.set(event.toolCallId, programId);

		const gateRead = async (rawPath: string, tool: string) => {
			const abs = canonicalize(rawPath, ctx.cwd);
			let reason = isDeniedRead(rawPath, ctx.cwd, policy);
			if (!reason) reason = isAskRead(rawPath, ctx.cwd, policy);
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
				const denied = deniedUrlReason(u, policy);
				if (denied) {
					audit({ layer: 2, tool: event.toolName, subject: u, reason: denied, decision: "no", note: "denied-domain", cwd: ctx.cwd });
					return { block: true, reason: denyMessage("allowDomains", denied) };
				}
				const reason = isAllowedUrl(u, policy);
				if (!reason) continue;
				const host = hostnameOf(u) ?? u;
				const result = await askOrBlock(/* SAFETY: pi's ctx carries cwd/UI at runtime. */ ctx as unknown as UICtx, { layer: 2, tool: event.toolName, subject: u, reason, overrideKind: "allowDomains", overrideValue: host }, null, (kind, value) => {
					if (kind === "allowDomains") emitDomainGrant(pi.events, value);
				});
				if (result) return result;
			}
		}

		if (event.toolName === "web_search") {
			const saReason = subagentNetworkBlock(ctx as { hasUI?: boolean; sessionManager?: unknown }, policy);
			if (saReason) return { block: true, reason: saReason };
		}

		if (policy.mode === "advanced-secure" && event.toolName.startsWith("mcp__")) {
			const det = await detectMcpAsk(pi, event.toolName, (event.input ?? {}) as Record<string, unknown>, /* SAFETY: pi's ctx carries cwd/UI at runtime. */ ctx as unknown as UICtx, policy.mcp);
			if (det) return det;
		}
	});

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

	pi.on("tool_result", async (event, ctx) => {
		if (!active || event.isError) return;
		const policy = loadPolicy(ctx.cwd);
		if (policy.mode !== "advanced-secure") return;
		const programId = event.toolCallId ? programIdByCallId.get(event.toolCallId) : undefined;
		if (programId && isProgramOutputGranted(programId)) {
			audit({ layer: 2, tool: event.toolName, decision: "session-grant", grant: programId, note: "advanced-secure-output", cwd: ctx.cwd });
			return;
		}
		const rawInput = event.input ?? {};
		const rawPath = rawInput.path ?? rawInput.file_path;
		const subject = (() => {
			if (typeof rawPath === "string" && rawPath) return rawPath;
			if (event.toolName === "bash") {
				const cmd = (event.input as { command?: string } | undefined)?.command;
				return cmd ? `bash (${cmd})` : "bash";
			}
			return event.toolName;
		})();
		const { types, hits } = collectExposure(event.content, subject);
		if (!types.length) return;
		const findings = types;
		const ui = /* SAFETY: pi's ctx carries cwd/UI at runtime; the local type only names the members used. */ ctx as unknown as UICtx;
		const choice = ui.hasUI !== false ? await askExposure(ui, hits, programId) : "block";
		if (choice === "allow" || choice === "program-session") {
			if (choice === "program-session" && programId) {
				grantProgramOutputSession(programId);
				audit({ layer: 2, tool: event.toolName, decision: "session", grant: programId, note: "advanced-secure-output", findings, cwd: ctx.cwd });
				ctx.ui.notify(`Output permitted: allowed all ${programId} output for this conversation.`, "info");
			} else {
				audit({ layer: 2, tool: event.toolName, decision: "yes", note: "advanced-secure-output", findings, cwd: ctx.cwd });
				ctx.ui.notify(`Output permitted: allowed ${event.toolName} output for this call.`, "info");
			}
			return;
		}
		audit({ layer: 2, tool: event.toolName, decision: "no", note: "advanced-secure-output", findings, cwd: ctx.cwd });
		ctx.ui.notify(`Sensitive data protected: withheld ${event.toolName} output from the AI (potential secrets detected).`, "warning");
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
				ctx.ui.notify("Done. The file applies now. Start a new conversation so the bash sandbox uses it too.", "info");
				return;
			}
			if (!active) {
				ctx.ui.notify(
					runtimeYolo ? "security-guard: inactive — YOLO is on (/permission-mode to turn it off)" : "security-guard: inactive (yolo or disabled)",
					"info",
				);
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
				`  conversation grants:    ${sessionGrantSummary() || "(none)"}`,
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
			if (policy.mode === "advanced-secure") {
				const mcp = policy.mcp ?? {};
				lines.push(
					"",
					"Advanced Secure (MCP gate, ADR-032):",
					`  allowTools:       ${(mcp.allowTools ?? []).join(", ") || "(none)"}`,
					`  allowPrefixes:    ${(mcp.allowPrefixes ?? []).join(", ") || "(none)"}`,
					`  askTools:         ${(mcp.askTools ?? []).join(", ") || "(none)"}`,
					`  trustAnnotations: ${mcp.trustAnnotations === true}`,
					`  allowSimpleUpdates: ${mcp.allowSimpleUpdates !== false}`,
					`  askThreshold:     ${mcp.askThreshold ?? 30}`,
				);
			}
			try {
				const tail = readFileSync(AUDIT_PATH, "utf-8").trim().split("\n").slice(-10);
				if (tail.length && tail[0]) {
					lines.push("", "Recent audit (last 10):");
					for (const l of tail) lines.push(`  ${l}`);
				}
			} catch {
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
