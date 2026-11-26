import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { evaluateMcpCall, type JsonSchemaLike, type McpPolicy, type McpToolAnnotations } from "#detect/index.ts";
import { askMain, formatTimeoutNote, MainChoice, notifyPromptTimeout, type PromptField } from "#ui/ask-flow.ts";
import { promptField } from "#ui/prompt-spec.ts";
import { audit } from "#shared/audit.ts";
import { rememberNativeNote } from "#shared/gate-notes.ts";
import { type UICtx } from "./prompts.ts";

const detectionGrants = new Set<string>();

export function clearDetectionGrants(): void {
	detectionGrants.clear();
}

export function createDetectionBlockMessage(action: "read" | "tool", reason: string): string {
	const actionSubject = action === "read" ? "Read" : "Tool call";
	const outcomeAction = action === "read" ? "read" : "run";

	return `${actionSubject} blocked by policy: ${reason}. Nothing was ${outcomeAction} — ask the user to adjust the permission mode (/permission-mode) if needed. Do not attempt workarounds or inspect plugin files.`;
}

export async function askDetectionConfirmation(
	context: UICtx,
	kind: "read" | "tool",
	subject: string,
	reason: string,
	details?: { toolCallId?: string; extraBlock?: string },
): Promise<{ block: true; reason: string } | null> {
	const grantKey = `${kind}:${subject}`;

	if (detectionGrants.has(grantKey)) {
		rememberNativeNote(details?.toolCallId, `Allowed for this conversation (${subject})`);
		return null;
	}

	if (context.hasUI === false) {
		audit({
			layer: 2,
			tool: kind,
			subject,
			reason,
			decision: "no",
			note: "advanced-secure-headless",
			cwd: context.cwd,
		});

		return { block: true, reason: createDetectionBlockMessage(kind, reason) };
	}

	const dialogHeader = kind === "read" ? `Let read open ${subject}?` : `Let ${subject} run?`;
	const fields: PromptField[] = [
		promptField(kind === "read" ? "File" : "Tool", subject),
		promptField("Why", reason),
		promptField("Note", "can only be allowed for this conversation or once"),
	];

	if (details?.extraBlock) {
		fields.push(promptField("Args", details.extraBlock, "dim"));
	}

	const choice = await askMain(
		context,
		dialogHeader,
		{ fields },
		{ session: true, remember: false, icon: kind === "read" ? "cred" : "warn" },
	);

	if (choice === "once") {
		audit({
			layer: 2,
			tool: kind,
			subject,
			reason,
			decision: "yes",
			note: "advanced-secure",
			cwd: context.cwd,
		});

		rememberNativeNote(details?.toolCallId, "Allowed once");
		return null;
	}

	if (choice === "session") {
		detectionGrants.add(grantKey);

		audit({
			layer: 2,
			tool: kind,
			subject,
			reason,
			decision: "session",
			note: "advanced-secure",
			cwd: context.cwd,
		});

		if (details?.toolCallId) {
			rememberNativeNote(details.toolCallId, `Allowed for this conversation: ${subject}`);
		} else {
			context.ui.notify(`Allowed for this conversation: ${subject}`, "info");
		}
		return null;
	}

	if (choice === MainChoice.TimedOut) {
		audit({
			layer: 2,
			tool: kind,
			subject,
			reason,
			decision: "no",
			note: "advanced-secure-timeout",
			cwd: context.cwd,
		});

		notifyPromptTimeout(context, details?.toolCallId);

		return { block: true, reason: createDetectionBlockMessage(kind, formatTimeoutNote().toLowerCase()) };
	}

	audit({
		layer: 2,
		tool: kind,
		subject,
		reason,
		decision: "no",
		note: "advanced-secure",
		cwd: context.cwd,
	});

	return { block: true, reason: createDetectionBlockMessage(kind, reason) };
}

export async function detectMcpAsk(
	pi: ExtensionAPI,
	toolName: string,
	input: Record<string, unknown>,
	context: UICtx,
	mcpPolicy?: McpPolicy,
	toolCallId?: string,
): Promise<{ block: true; reason: string } | null> {
	const toolInfo = pi.getAllTools().find((registeredTool) => registeredTool.name === toolName);

	const evaluation = evaluateMcpCall({
		tool: {
			name: toolName,
			description: toolInfo?.description,
			inputSchema:
				/* SAFETY: ToolInfo.parameters is a JSON Schema; JsonSchemaLike is its structural subset. */
				toolInfo?.parameters as JsonSchemaLike | undefined,
			annotations:
				/* SAFETY: pi's ToolAnnotations mirrors the MCP hints McpToolAnnotations names. */
				toolInfo?.annotations as McpToolAnnotations | undefined,
		},
		call: { name: toolName, arguments: input },
		policy: mcpPolicy,
	});

	if (evaluation.decision !== "ask") {
		return null;
	}

	let extraBlock: string | undefined;

	if (input && Object.keys(input).length > 0) {
		const rawScript = input.code ?? input.script ?? input.command ?? input.query;

		if (typeof rawScript === "string" && rawScript.includes("\n")) {
			extraBlock = rawScript;
		} else {
			const formattedArguments = JSON.stringify(input, null, 2);

			if (formattedArguments.includes("\n")) {
				extraBlock = formattedArguments;
			}
		}
	}

	return askDetectionConfirmation(context, "tool", toolName, evaluation.summary, { toolCallId, extraBlock });
}
