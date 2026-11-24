export const ToolStatus = {
	Running: "running",
	Ok: "ok",
	Failed: "failed",
	Blocked: "blocked",
	Denied: "denied",
} as const;
export type ToolStatus = (typeof ToolStatus)[keyof typeof ToolStatus];

const SPINNER_FRAMES: readonly string[] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const OK_MARK = "✓";
const FAILED_MARK = "✗";
const BLOCKED_MARK = "⚠";
const DENIED_MARK = "⊘";
const BLOCKED_WORD = "blocked";
const DENIED_WORD = "denied";
const DENIED_BY_USER_PATTERN = /denied by user/i;
const BLOCKED_BY_POLICY_PATTERN =
	/blocked by policy|security block|security policy notice|blocked \(automated environment\)/i;

export function statusFromResult(isError: boolean, resultText: string): ToolStatus {
	if (!isError) {
		return ToolStatus.Ok;
	}

	if (DENIED_BY_USER_PATTERN.test(resultText)) {
		return ToolStatus.Denied;
	}

	if (BLOCKED_BY_POLICY_PATTERN.test(resultText)) {
		return ToolStatus.Blocked;
	}

	return ToolStatus.Failed;
}

export function statusMark(status: ToolStatus, spinnerFrame = 0): string {
	if (status === ToolStatus.Running) {
		const index = Math.abs(Math.floor(spinnerFrame)) % SPINNER_FRAMES.length;

		return SPINNER_FRAMES[index];
	}

	if (status === ToolStatus.Ok) {
		return OK_MARK;
	}

	if (status === ToolStatus.Blocked) {
		return BLOCKED_MARK;
	}

	if (status === ToolStatus.Denied) {
		return DENIED_MARK;
	}

	return FAILED_MARK;
}

export function statusWord(status: ToolStatus): string | undefined {
	if (status === ToolStatus.Blocked) {
		return BLOCKED_WORD;
	}

	return status === ToolStatus.Denied ? DENIED_WORD : undefined;
}
