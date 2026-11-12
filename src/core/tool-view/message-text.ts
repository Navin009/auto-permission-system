const TEXT_BLOCK_TYPE = "text";
const THINKING_BLOCK_TYPE = "thinking";
const THOUGHT_BLOCK_SEPARATOR = " ";
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
	return trailingThoughtBlocks(message).length > 0;
}

export function streamingThoughtText(message: MessageContent): string {
	const thoughts = trailingThoughtBlocks(message)
		.map((block) => (block.thinking ?? BLANK_TEXT).trim())
		.filter((thought) => thought !== BLANK_TEXT);

	return thoughts.join(THOUGHT_BLOCK_SEPARATOR);
}

function trailingThoughtBlocks(message: MessageContent): MessageBlock[] {
	const content = message.content;

	if (content === undefined || typeof content === "string") {
		return [];
	}

	const trailing: MessageBlock[] = [];

	for (let index = content.length - 1; index >= 0; index -= 1) {
		const block = content[index];

		if (block.type !== THINKING_BLOCK_TYPE) {
			break;
		}

		trailing.unshift(block);
	}

	return trailing;
}

function isTextBlock(block: MessageBlock): boolean {
	return block.type === TEXT_BLOCK_TYPE && (block.text ?? BLANK_TEXT).trim() !== BLANK_TEXT;
}
