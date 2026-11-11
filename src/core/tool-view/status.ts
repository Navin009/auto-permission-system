export const StatusMark = {
	Running: "",
	Ok: "✓",
	Failed: "✗",
	Blocked: "✗ blocked",
	Denied: "✗ denied",
} as const;
export type StatusMark = (typeof StatusMark)[keyof typeof StatusMark];

const DENIED_BY_USER_PATTERN = /denied by user/i;
const BLOCKED_BY_POLICY_PATTERN =
	/blocked by policy|security block|security policy notice|blocked \(automated environment\)/i;

export function statusFromResult(isError: boolean, resultText: string): StatusMark {
	if (!isError) {
		return StatusMark.Ok;
	}

	if (DENIED_BY_USER_PATTERN.test(resultText)) {
		return StatusMark.Denied;
	}

	if (BLOCKED_BY_POLICY_PATTERN.test(resultText)) {
		return StatusMark.Blocked;
	}

	return StatusMark.Failed;
}
