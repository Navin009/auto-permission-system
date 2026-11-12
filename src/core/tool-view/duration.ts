const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const TENTH_OF_A_SECOND_LIMIT_MILLISECONDS = 10_000;
const TENTHS_PER_SECOND = 10;
const MILLISECOND_SUFFIX = "ms";
const SECOND_SUFFIX = "s";
const MINUTE_SUFFIX = "m";
const DURATION_SEPARATOR = " ";

export function formatDuration(milliseconds: number): string {
	const totalSeconds = Math.floor(safeMilliseconds(milliseconds) / MILLISECONDS_PER_SECOND);

	if (totalSeconds < SECONDS_PER_MINUTE) {
		return `${totalSeconds}${SECOND_SUFFIX}`;
	}

	const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
	const remainingSeconds = totalSeconds % SECONDS_PER_MINUTE;

	return `${minutes}${MINUTE_SUFFIX}${DURATION_SEPARATOR}${remainingSeconds}${SECOND_SUFFIX}`;
}

export function formatCommandDuration(milliseconds: number): string {
	const safe = safeMilliseconds(milliseconds);

	if (safe < MILLISECONDS_PER_SECOND) {
		return `${Math.round(safe)}${MILLISECOND_SUFFIX}`;
	}

	if (safe < TENTH_OF_A_SECOND_LIMIT_MILLISECONDS) {
		const tenths = Math.round(safe / (MILLISECONDS_PER_SECOND / TENTHS_PER_SECOND));
		const seconds = Math.floor(tenths / TENTHS_PER_SECOND);
		const remainingTenths = tenths % TENTHS_PER_SECOND;

		return remainingTenths === 0 ? `${seconds}${SECOND_SUFFIX}` : `${seconds}.${remainingTenths}${SECOND_SUFFIX}`;
	}

	return formatDuration(safe);
}

function safeMilliseconds(milliseconds: number): number {
	return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
}
