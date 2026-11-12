const TEXT_BLOCK_TYPE = "text";
const THINKING_BLOCK_TYPE = "thinking";
const BLANK_TEXT = "";

export interface MessageBlock {
	type: string;
	text?: string;
	thinking?: string;
}

export interface MessageContent {
	role?: string;
	content?: string | readonly MessageBlock[];
}

export function carriesVisibleText(message: MessageContent): boolean {
	const content = message.content;

	if (content === undefined) {
		return false;
	}

	if (typeof content === "string") {
		return content.trim() !== BLANK_TEXT;
	}

	return content.some(isTextBlock);
}

export function carriesStreamingThought(message: MessageContent): boolean {
	const content = message.content;

	if (content === undefined || typeof content === "string") {
		return false;
	}

	return content.at(-1)?.type === THINKING_BLOCK_TYPE;
}

function isTextBlock(block: MessageBlock): boolean {
	return block.type === TEXT_BLOCK_TYPE && (block.text ?? BLANK_TEXT).trim() !== BLANK_TEXT;
}
