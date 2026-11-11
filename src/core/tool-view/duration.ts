const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

export function formatDuration(milliseconds: number): string {
	const safeMilliseconds = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
	const totalSeconds = Math.floor(safeMilliseconds / MILLISECONDS_PER_SECOND);

	if (totalSeconds < SECONDS_PER_MINUTE) {
		return `${totalSeconds}s`;
	}

	const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
	const remainingSeconds = totalSeconds % SECONDS_PER_MINUTE;

	return `${minutes}m ${remainingSeconds}s`;
}
