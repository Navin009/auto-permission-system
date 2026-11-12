const TEXT_BLOCK_TYPE = "text";
const BLANK_TEXT = "";

export interface MessageBlock {
	type: string;
	text?: string;
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

function isTextBlock(block: MessageBlock): boolean {
	return block.type === TEXT_BLOCK_TYPE && (block.text ?? BLANK_TEXT).trim() !== BLANK_TEXT;
}
