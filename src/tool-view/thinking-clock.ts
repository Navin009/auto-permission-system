import type { ThinkingState } from "../core/tool-view/thinking.ts";

const TICK_INTERVAL_MILLISECONDS = 1000;
const NO_THOUGHT_TEXT = "";

let startedAt: number | undefined;
let thoughtCount = 0;
let ticker: ReturnType<typeof setInterval> | undefined;
let repaint: (() => void) | undefined;
let text = NO_THOUGHT_TEXT;
let isExpanded = false;
let isLineHidden = false;

export function setThinkingRepaint(listener: (() => void) | undefined): void {
	repaint = listener;
}

export function beginThinking(thoughtText = NO_THOUGHT_TEXT): void {
	if (startedAt === undefined) {
		startedAt = Date.now();
		thoughtCount += 1;
		isExpanded = false;
		isLineHidden = false;
		startTicker();
	}

	text = thoughtText;
	repaint?.();
}

export function endThinking(): void {
	if (startedAt === undefined) {
		return;
	}

	startedAt = undefined;
	text = NO_THOUGHT_TEXT;
	isExpanded = false;
	isLineHidden = false;
	stopTicker();
	repaint?.();
}

export function hideThoughtLine(): void {
	if (startedAt === undefined || isLineHidden) {
		return;
	}

	isLineHidden = true;
	isExpanded = false;
	repaint?.();
}

export function toggleThoughtExpansion(): void {
	if (startedAt === undefined || isLineHidden) {
		return;
	}

	isExpanded = !isExpanded;
	repaint?.();
}

export function thoughtText(): string {
	return text;
}

export function thoughtExpanded(): boolean {
	return isExpanded;
}

export function thoughtLineHidden(): boolean {
	return isLineHidden;
}

export function thoughtRevision(): number {
	return thoughtCount;
}

export function thinkingState(): ThinkingState | undefined {
	if (startedAt === undefined) {
		return undefined;
	}

	return { startedAt, now: Date.now() };
}

export function resetThinking(): void {
	startedAt = undefined;
	thoughtCount = 0;
	text = NO_THOUGHT_TEXT;
	isExpanded = false;
	isLineHidden = false;
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
