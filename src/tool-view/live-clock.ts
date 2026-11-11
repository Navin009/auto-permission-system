const TICK_INTERVAL_MILLISECONDS = 250;

const startedAtByCall = new Map<string, number>();
const tickTimersByCall = new Map<string, ReturnType<typeof setInterval>>();

export function beginCall(toolCallId: string, invalidate: () => void): void {
	if (!startedAtByCall.has(toolCallId)) {
		startedAtByCall.set(toolCallId, Date.now());
	}

	stopTick(toolCallId);

	const tickTimer = setInterval(() => invalidate(), TICK_INTERVAL_MILLISECONDS);
	tickTimer.unref?.();

	tickTimersByCall.set(toolCallId, tickTimer);
}

export function elapsedMilliseconds(toolCallId: string): number {
	const startedAt = startedAtByCall.get(toolCallId);

	return startedAt === undefined ? 0 : Date.now() - startedAt;
}

export function endCall(toolCallId: string): void {
	stopTick(toolCallId);
	startedAtByCall.delete(toolCallId);
}

export function endAllCalls(): void {
	for (const toolCallId of [...tickTimersByCall.keys()]) {
		stopTick(toolCallId);
	}

	startedAtByCall.clear();
}

function stopTick(toolCallId: string): void {
	const tickTimer = tickTimersByCall.get(toolCallId);

	if (tickTimer) {
		clearInterval(tickTimer);
	}

	tickTimersByCall.delete(toolCallId);
}
