const THINKING_WORD = "thinking";
const WORD_SEPARATOR = " ";
const SECOND_SUFFIX = "s";
const MILLISECONDS_PER_SECOND = 1000;
const BRACKET_OPEN = "(";
const BRACKET_CLOSE = ")";
const WHITESPACE_PATTERN = /\s+/g;
const WORD_BREAK = " ";

export interface ThinkingState {
	startedAt: number;
	now: number;
}

export function thinkingPart(state: ThinkingState): string {
	return `${BRACKET_OPEN}${THINKING_WORD}${WORD_SEPARATOR}${elapsedSeconds(state)}${SECOND_SUFFIX}${BRACKET_CLOSE}`;
}

export function collapseThought(text: string): string {
	return text.replace(WHITESPACE_PATTERN, WORD_BREAK).trim();
}

export function elapsedSeconds(state: ThinkingState): number {
	const elapsed = state.now - state.startedAt;

	if (!Number.isFinite(elapsed)) {
		return 0;
	}

	return Math.max(0, Math.floor(elapsed / MILLISECONDS_PER_SECOND));
}
