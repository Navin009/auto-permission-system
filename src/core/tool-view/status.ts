export const StatusMark = {
	Running: "",
	Ok: "✓",
	Failed: "✗",
	Blocked: "✗ blocked",
	Denied: "✗ denied",
} as const;
export type StatusMark = (typeof StatusMark)[keyof typeof StatusMark];

const DENIED_BY_USER_MARKER = "denied by user";
const BLOCKED_MARKER = "block";

export function statusFromResult(isError: boolean, resultText: string): StatusMark {
	const loweredText = resultText.toLowerCase();

	if (loweredText.includes(DENIED_BY_USER_MARKER)) {
		return StatusMark.Denied;
	}

	if (loweredText.includes(BLOCKED_MARKER)) {
		return StatusMark.Blocked;
	}

	return isError ? StatusMark.Failed : StatusMark.Ok;
}
