import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { evaluateMcpCall, type JsonSchemaLike, type McpPolicy, type McpToolAnnotations } from "../detect/index.ts";
import { askMain } from "../ui/ask-flow.ts";
import { audit } from "../shared/audit.ts";
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
): Promise<{ block: true; reason: string } | null> {
	const grantKey = `${kind}:${subject}`;

	if (detectionGrants.has(grantKey)) {
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

	const dialogHeader = kind === "read" ? "Read blocked — sensitive file" : "Tool call blocked — risky";
	const dialogBody = `  ${kind === "read" ? "file" : "tool"}:  ${subject}\n  why:   ${reason}`;

	const choice = await askMain(context, dialogHeader, dialogBody, { session: true, remember: false });

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

		context.ui.notify(`Allowed for this conversation: ${subject}`, "info");
		return null;
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

	let summary = evaluation.summary;

	if (input && Object.keys(input).length > 0) {
		const rawScript = input.code ?? input.script ?? input.command ?? input.query;

		if (typeof rawScript === "string" && rawScript.includes("\n")) {
			summary += `\n\n${rawScript}`;
		} else {
			const formattedArguments = JSON.stringify(input, null, 2);

			if (formattedArguments.includes("\n")) {
				summary += `\n\nArguments:\n${formattedArguments}`;
			}
		}
	}

	return askDetectionConfirmation(context, "tool", toolName, summary);
}
