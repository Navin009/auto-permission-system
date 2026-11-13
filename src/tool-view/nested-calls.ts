export type NestedCallStatus = "running" | "ok" | "error";

export interface NestedCall {
	toolCallId: string;
	name: string;
	detail: string;
	status: NestedCallStatus;
}

const ARGUMENT_PREVIEW_LENGTH = 40;
const NAME_SEPARATOR = " ";
const EMPTY = "";

let callsByParent = new Map<string, NestedCall[]>();

export function rememberNestedStart(
	parentToolCallId: string,
	toolCallId: string,
	toolName: string,
	args: unknown,
): void {
	const calls = callsByParent.get(parentToolCallId) ?? [];

	if (calls.some((call) => call.toolCallId === toolCallId)) {
		return;
	}

	calls.push({
		toolCallId,
		name: toolName,
		detail: argumentPreview(args),
		status: "running",
	});
	callsByParent.set(parentToolCallId, calls);
}

export function rememberNestedEnd(
	parentToolCallId: string,
	toolCallId: string,
	isError: boolean,
): void {
	const call = callsByParent
		.get(parentToolCallId)
		?.find((candidate) => candidate.toolCallId === toolCallId);

	if (!call) {
		return;
	}

	call.status = isError ? "error" : "ok";
}

export function nestedCallsFor(parentToolCallId: string): readonly NestedCall[] {
	return callsByParent.get(parentToolCallId) ?? [];
}

export function resetNestedCalls(): void {
	callsByParent = new Map<string, NestedCall[]>();
}

function argumentPreview(args: unknown): string {
	if (args === null || typeof args !== "object") {
		return EMPTY;
	}

	for (const value of Object.values(args as Record<string, unknown>)) {
		if (typeof value === "string" && value.trim()) {
			return shorten(value.trim());
		}

		if (typeof value === "number" || typeof value === "boolean") {
			return String(value);
		}
	}

	return EMPTY;
}

function shorten(text: string): string {
	const oneLine = text.replace(/\s+/g, NAME_SEPARATOR).trim();

	return oneLine.length > ARGUMENT_PREVIEW_LENGTH
		? `${oneLine.slice(0, ARGUMENT_PREVIEW_LENGTH - 1)}…`
		: oneLine;
}
