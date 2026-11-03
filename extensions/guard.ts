import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType, getAgentDir } from "@earendil-works/pi-coding-agent";
import { policyFileError, isProjectFileDeclined } from "../src/core/index.ts";
import { classifyFilename } from "../src/detect/index.ts";
import {
	loadPolicy,
	projectPolicyPath,
	setPiDeclinedTrust,
	untrustedProjectChanges,
	TRUST_STORE,
} from "../src/l2-guard/policy.ts";
import { canonicalize } from "../src/l2-guard/matching.ts";
import { audit } from "../src/shared/audit.ts";
import { clearSessionGrants, type UICtx } from "../src/l2-guard/prompts.ts";
import { clearProgramOutputSessionGrants } from "../src/l2-guard/program-grants.ts";
import { programIdForToolCall } from "../src/l2-guard/program-id.ts";
import { emitDomainGrant } from "../src/shared/network-grants.ts";
import { subagentNetworkBlock } from "../src/l2-guard/subagent.ts";
import { onYolo } from "../src/shared/yolo.ts";
import {
	askDetectionConfirmation,
	clearDetectionGrants,
	detectMcpAsk,
} from "../src/l2-guard/detection.ts";
import {
	checkNetworkAccess,
	checkReadAccess,
	checkWriteAccess,
	extractUrlsFromInput,
} from "../src/l2-guard/tool-gates.ts";
import {
	clearProgramIds,
	filterGrepToolResult,
	gateSensitiveToolOutput,
	recordProgramIdForCall,
} from "../src/l2-guard/output-gates.ts";
import { formatSecurityGuardReport, handleProjectTrustCommand } from "../src/l2-guard/report.ts";

export default function (pi: ExtensionAPI) {
	let isGuardActive = false;
	let isPolicyEnabled = false;
	let isRuntimeYolo = false;

	const updateActiveState = () => {
		isGuardActive = isPolicyEnabled && !isRuntimeYolo;
	};

	onYolo(pi.events, (enabled) => {
		isRuntimeYolo = enabled;
		updateActiveState();

		if (enabled) {
			clearDetectionGrants();
		}
	});

	pi.on("session_start", (_event, context) => {
		for (const policyPath of [`${getAgentDir()}/extensions/sandbox.json`, `${context.cwd}/.pi/sandbox.json`]) {
			const parseError = policyFileError(policyPath);

			if (!parseError) {
				continue;
			}

			audit({
				layer: 2,
				event: "policy-parse-error",
				file: policyPath,
				error: parseError,
				cwd: context.cwd,
			});

			console.error(`security-guard: ${policyPath} does not parse (${parseError}); its rules are NOT applied`);

			const isProject = policyPath === `${context.cwd}/.pi/sandbox.json`;
			const errorMessage = isProject
				? "⚠️  Syntax error in settings file — project configuration not loaded."
				: "⚠️  Syntax error in settings file — global configuration not loaded.";

			context.ui.notify(errorMessage, "error");
		}

		setPiDeclinedTrust((context as { isProjectTrusted?: () => boolean }).isProjectTrusted?.() === false);

		const changes = untrustedProjectChanges(context.cwd);

		if (changes.length && !isProjectFileDeclined(projectPolicyPath(context.cwd), TRUST_STORE)) {
			audit({
				layer: 2,
				event: "untrusted-project-policy",
				file: projectPolicyPath(context.cwd),
				changes,
				cwd: context.cwd,
			});

			context.ui.notify("🛡️  Project-level configuration detected: run /security trust to approve.", "warning");
		}

		const policy = loadPolicy(context.cwd);

		if (!policy.enabled) {
			isPolicyEnabled = false;
			updateActiveState();
			context.ui.notify("Tool guard is disabled in your sandbox.json settings.", "info");
			return;
		}

		isPolicyEnabled = true;
		updateActiveState();

		clearSessionGrants();
		clearDetectionGrants();
		clearProgramOutputSessionGrants();
		clearProgramIds();
	});

	pi.on("tool_call", async (event, context) => {
		if (!isGuardActive) {
			return;
		}

		const policy = loadPolicy(context.cwd);
		const programId = programIdForToolCall(event.toolName, event.input);

		if (event.toolCallId && programId) {
			recordProgramIdForCall(event.toolCallId, programId);
		}

		if (isToolCallEventType("read", event)) {
			const result = await checkReadAccess(event.input.path, "read", context, policy);

			if (result) {
				return result;
			}

			if (policy.mode === "advanced-secure") {
				const canonicalPath = canonicalize(event.input.path, context.cwd);
				const classification = classifyFilename(canonicalPath);

				if (classification.risk === "strong") {
					const verdict = await askDetectionConfirmation(
						/* SAFETY: pi's ctx carries cwd/UI at runtime. */
						context as unknown as UICtx,
						"read",
						canonicalPath,
						classification.reasons[0] ?? "sensitive filename",
					);

					if (verdict) {
						return verdict;
					}
				}
			}
		}

		const searchRoot =
			isToolCallEventType("grep", event) || isToolCallEventType("find", event) || isToolCallEventType("ls", event)
				? (event.input.path ?? ".")
				: null;

		if (searchRoot !== null) {
			const result = await checkReadAccess(searchRoot, event.toolName, context, policy);

			if (result) {
				return result;
			}
		}

		if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
			const result = await checkWriteAccess(event.input.path, event.toolName, context, policy);

			if (result) {
				return result;
			}
		}

		const toolInput = event.input as Record<string, unknown> | undefined;

		if (event.toolName === "fetch_content" || event.toolName === "get_search_content") {
			const subagentReason = subagentNetworkBlock(
				context as { hasUI?: boolean; sessionManager?: unknown },
				policy,
			);

			if (subagentReason) {
				return { block: true, reason: subagentReason };
			}

			const targetUrls = extractUrlsFromInput(toolInput);
			const networkResult = await checkNetworkAccess(
				targetUrls,
				event.toolName,
				context,
				policy,
				(domain) => emitDomainGrant(pi.events, domain),
			);

			if (networkResult) {
				return networkResult;
			}
		}

		if (event.toolName === "web_search") {
			const subagentReason = subagentNetworkBlock(
				context as { hasUI?: boolean; sessionManager?: unknown },
				policy,
			);

			if (subagentReason) {
				return { block: true, reason: subagentReason };
			}
		}

		if (policy.mode === "advanced-secure" && event.toolName.startsWith("mcp__")) {
			const verdict = await detectMcpAsk(
				pi,
				event.toolName,
				(event.input ?? {}) as Record<string, unknown>,
				/* SAFETY: pi's ctx carries cwd/UI at runtime. */
				context as unknown as UICtx,
				policy.mcp,
			);

			if (verdict) {
				return verdict;
			}
		}
	});

	pi.on("tool_result", (event, context) => {
		if (!isGuardActive) {
			return;
		}

		const policy = loadPolicy(context.cwd);
		return filterGrepToolResult(event, context, policy);
	});

	pi.on("tool_result", async (event, context) => {
		if (!isGuardActive) {
			return;
		}

		const policy = loadPolicy(context.cwd);
		return gateSensitiveToolOutput(event, context, policy);
	});

	pi.registerCommand?.("security", {
		description:
			"Show Layer 2 policy and status. /security trust | untrust: trust this project's .pi/sandbox.json as it is now, or stop trusting it",
		handler: async (args, context) => {
			const subcommand = String(args ?? "").trim();

			if (subcommand === "trust" || subcommand === "untrust") {
				await handleProjectTrustCommand(context, subcommand);
				return;
			}

			if (!isGuardActive) {
				const inactiveMessage = isRuntimeYolo
					? "security-guard: inactive — YOLO is on (/permission-mode to turn it off)"
					: "security-guard: inactive (yolo or disabled)";

				context.ui.notify(inactiveMessage, "info");
				return;
			}

			const policy = loadPolicy(context.cwd);
			context.ui.notify(formatSecurityGuardReport(policy, context), "info");
		},
	});
}
