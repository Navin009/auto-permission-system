const THINKING_BLOCK_TYPE = "thinking";
const TOOL_CALL_BLOCK_TYPE = "toolCall";
const ASSISTANT_ROLE = "assistant";

export interface MessageBlock {
	type: string;
	id?: string;
	thinking?: string;
}

export interface MessageContent {
	role?: string;
	content?: string | readonly MessageBlock[];
	stopReason?: string;
	errorMessage?: string;
}

let messageByCall = new Map<string, MessageContent>();

export function rememberAssistantMessage(message: MessageContent): void {
	if (message.role !== ASSISTANT_ROLE || typeof message.content === "string") {
		return;
	}

	const blocks = message.content;

	if (!blocks || !blocks.some((block) => block.type === THINKING_BLOCK_TYPE)) {
		return;
	}

	for (const block of blocks) {
		if (block.type === TOOL_CALL_BLOCK_TYPE && block.id) {
			messageByCall.set(block.id, message);
		}
	}
}

export function thoughtForCall(toolCallId: string): MessageContent | undefined {
	const message = messageByCall.get(toolCallId);

	if (!message) {
		return undefined;
	}

	return {
		...message,
		content: thinkingBlocks(message),
		stopReason: "stop",
		errorMessage: undefined,
	};
}

export function resetThoughts(): void {
	messageByCall = new Map<string, MessageContent>();
}

function thinkingBlocks(message: MessageContent): readonly MessageBlock[] {
	if (typeof message.content === "string" || message.content === undefined) {
		return [];
	}

	return message.content.filter((block) => block.type === THINKING_BLOCK_TYPE);
}
