import type { ThinkingState } from "../core/tool-view/thinking.ts";

const TICK_INTERVAL_MILLISECONDS = 1000;

let startedAt: number | undefined;
let ticker: ReturnType<typeof setInterval> | undefined;
let repaint: (() => void) | undefined;

export function setThinkingRepaint(listener: (() => void) | undefined): void {
	repaint = listener;
}

export function beginThinking(): void {
	if (startedAt !== undefined) {
		return;
	}

	startedAt = Date.now();
	startTicker();
	repaint?.();
}

export function endThinking(): void {
	if (startedAt === undefined) {
		return;
	}

	startedAt = undefined;
	stopTicker();
	repaint?.();
}

export function thinkingState(): ThinkingState | undefined {
	if (startedAt === undefined) {
		return undefined;
	}

	return { startedAt, now: Date.now() };
}

export function resetThinking(): void {
	startedAt = undefined;
	stopTicker();
}

function startTicker(): void {
	if (ticker) {
		return;
	}

	const started = setInterval(() => repaint?.(), TICK_INTERVAL_MILLISECONDS);
	started.unref?.();

	ticker = started;
}

function stopTicker(): void {
	if (ticker) {
		clearInterval(ticker);
	}

	ticker = undefined;
}
