import { statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ExtensionContext, ToolResultEvent, ToolResultEventResult } from "@earendil-works/pi-coding-agent";
import { filterGrepOutput } from "#core/index.ts";
import { redactText } from "#detect/index.ts";
import { collectExposure } from "./exposure.ts";
import { askExposure, ExposureChoice, formatTimeoutNote, withheldNotice } from "#ui/ask-flow.ts";
import { audit } from "#shared/audit.ts";
import { rememberGateNote } from "#shared/gate-notes.ts";
import { canonicalize, isAskRead, isDeniedRead } from "./matching.ts";
import { grantProgramOutputSession, isProgramOutputGranted } from "./program-grants.ts";
import type { Policy } from "./policy.ts";
import type { UICtx } from "./prompts.ts";
import { GUARD_NAME } from "#shared/messages.ts";

const programIdByCallId = new Map<string, string>();
const shownAllowNotices = new Set<string>();

export function clearAllowNotices(): void {
	shownAllowNotices.clear();
}

export function recordProgramIdForCall(toolCallId: string, programId: string): void {
	programIdByCallId.set(toolCallId, programId);
}

export function clearProgramIds(): void {
	programIdByCallId.clear();
}

export function filterGrepToolResult(
	event: ToolResultEvent,
	context: ExtensionContext,
	policy: Policy,
): ToolResultEventResult | undefined {
	if (event.toolName !== "grep" || event.isError) {
		return undefined;
	}

	const input = event.input as { path?: string } | undefined;
	const searchRoot = canonicalize(input?.path ?? ".", context.cwd);

	let rootIsDirectory = false;

	try {
		rootIsDirectory = statSync(searchRoot).isDirectory();
	} catch {
		return undefined;
	}

	if (!rootIsDirectory) {
		return undefined;
	}

	let removedLineCount = 0;
	const removedFileNames = new Set<string>();

	const contentBlocks = event.content.map((contentBlock) => {
		if (contentBlock.type !== "text" || !contentBlock.text) {
			return contentBlock;
		}

		const filterResult = filterGrepOutput(contentBlock.text, (printed) => {
			const targetPath = isAbsolute(printed) ? printed : join(searchRoot, printed);

			return (
				isDeniedRead(targetPath, context.cwd, policy) !== null || isAskRead(targetPath, context.cwd, policy) !== null
			);
		});

		removedLineCount += filterResult.removedLines;

		for (const fileName of filterResult.removedFiles) {
			removedFileNames.add(fileName);
		}

		return { ...contentBlock, text: filterResult.text };
	});

	if (removedLineCount === 0) {
		return undefined;
	}

	audit({
		layer: 2,
		tool: "grep",
		subject: searchRoot,
		decision: "redacted",
		removedLines: removedLineCount,
		removedFiles: [...removedFileNames],
		cwd: context.cwd,
	});

	const redactionNotice = `${GUARD_NAME}: removed ${removedLineCount} line(s) from ${removedFileNames.size} file(s) that match the read-deny policy`;
	const noteCallId = event.parentToolCallId ?? event.toolCallId;

	rememberGateNote(noteCallId, redactionNotice);

	if (!noteCallId) {
		(context.ui as { notify?: (message: string, level?: string) => void } | undefined)?.notify?.(
			redactionNotice,
			"warning",
		);
	}

	contentBlocks.push({
		type: "text" as const,
		text: `\n[${redactionNotice}]`,
	});

	return { content: contentBlocks as ToolResultEventResult["content"] };
}

function resolveOutputSubject(rawInput: Record<string, unknown>, toolName: string): string {
	const rawPath = rawInput.path ?? rawInput.file_path;

	if (typeof rawPath === "string" && rawPath) {
		return rawPath;
	}

	if (toolName === "bash") {
		const commandInput = (rawInput as { command?: string }).command;

		if (!commandInput) return "bash";

		/* The audit log outlives the command, so an inline credential is redacted here. */
		return `bash (${redactText(commandInput).text})`;
	}

	return toolName;
}

export async function gateSensitiveToolOutput(
	event: ToolResultEvent,
	context: ExtensionContext,
	policy: Policy,
): Promise<ToolResultEventResult | undefined> {
	if (event.isError || policy.mode !== "advanced-secure") {
		return undefined;
	}

	const programId = event.toolCallId ? programIdByCallId.get(event.toolCallId) : undefined;

	if (programId && isProgramOutputGranted(programId)) {
		audit({
			layer: 2,
			tool: event.toolName,
			decision: "session-grant",
			grant: programId,
			note: "advanced-secure-output",
			cwd: context.cwd,
		});

		return undefined;
	}

	const rawInput = (event.input ?? {}) as Record<string, unknown>;
	const subject = resolveOutputSubject(rawInput, event.toolName);

	const { types, hits } = collectExposure(event.content, subject, { flagNonText: event.toolName !== "read" });

	if (!types.length) {
		return undefined;
	}

	const findings = types;
	const uiContext =
		/* SAFETY: pi's ctx carries cwd/UI at runtime; the local type only names the members used. */
		context as unknown as UICtx;

	const userChoice = uiContext.hasUI === false ? "block" : await askExposure(uiContext, hits, programId);
	const noteCallId = event.parentToolCallId ?? event.toolCallId;

	if (userChoice === "allow" || userChoice === "program-session") {
		if (userChoice === "program-session" && programId) {
			grantProgramOutputSession(programId);

			audit({
				layer: 2,
				tool: event.toolName,
				decision: "session",
				grant: programId,
				note: "advanced-secure-output",
				findings,
				cwd: context.cwd,
			});

			const grantNotice = `Output permitted: allowed all ${programId} output for this conversation.`;

			rememberGateNote(noteCallId, grantNotice);

			if (!noteCallId) {
				context.ui.notify(grantNotice, "info");
			}
		} else {
			audit({
				layer: 2,
				tool: event.toolName,
				decision: "yes",
				note: "advanced-secure-output",
				findings,
				cwd: context.cwd,
			});

			const allowNotice = `Output permitted: allowed ${event.toolName} output for this call.`;

			rememberGateNote(noteCallId, allowNotice);

			if (!noteCallId && !shownAllowNotices.has(allowNotice)) {
				shownAllowNotices.add(allowNotice);
				context.ui.notify(allowNotice, "info");
			}
		}

		return undefined;
	}

	const isTimedOut = userChoice === ExposureChoice.TimedOut;

	audit({
		layer: 2,
		tool: event.toolName,
		decision: "no",
		note: isTimedOut ? "advanced-secure-output-timeout" : "advanced-secure-output",
		findings,
		cwd: context.cwd,
	});

	const protectedNotice = isTimedOut
		? `Sensitive data protected: ${event.toolName} output was hidden from the AI (${formatTimeoutNote().toLowerCase()}).`
		: `Sensitive data protected: ${event.toolName} output was hidden from the AI (potential secrets detected).`;

	rememberGateNote(noteCallId, protectedNotice);

	if (isTimedOut && !noteCallId) {
		context.ui.notify(protectedNotice, "warning");
	}

	return { content: [{ type: "text" as const, text: withheldNotice(subject) }] };
}
