const THINKING_WORD = "thinking";
const ELLIPSIS = "…";
const SECOND_SUFFIX = "s";
const WORD_SEPARATOR = " ";
const MILLISECONDS_PER_SECOND = 1000;

export interface ThinkingState {
	startedAt: number;
	now: number;
}

export function thinkingPart(state: ThinkingState): string {
	return `${THINKING_WORD}${ELLIPSIS}${WORD_SEPARATOR}${elapsedSeconds(state)}${SECOND_SUFFIX}`;
}

export function elapsedSeconds(state: ThinkingState): number {
	const elapsed = state.now - state.startedAt;

	if (!Number.isFinite(elapsed)) {
		return 0;
	}

	return Math.max(0, Math.floor(elapsed / MILLISECONDS_PER_SECOND));
}
