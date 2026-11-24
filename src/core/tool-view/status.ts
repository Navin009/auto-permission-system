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
const NOTICE_TAG_PATTERN = /^\[(?:Security Block|Security Policy Notice)\]\s*/i;
const LAYER_PREFIX_PATTERN = /^(?:sandbox|security-guard):\s*/i;
const POLICY_PREFIX_PATTERN = /^(?:Read|Write|Network)\s+blocked by policy:\s*/i;
const TRAILING_BOILERPLATE_PATTERN = /\.\s*(?:Nothing was\b|Fix the sandbox\b|Do not attempt\b).*$/i;
const FIRST_LINE_BREAK_PATTERN = /\r?\n/;
const WHITESPACE_PATTERN = /\s+/g;
const SPACE = " ";
const ELLIPSIS = "…";
const MAX_BLOCK_REASON_LENGTH = 80;

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

export function shortBlockReason(status: ToolStatus, resultText: string): string | undefined {
	if (status !== ToolStatus.Blocked && status !== ToolStatus.Denied) {
		return undefined;
	}

	const firstLine = resultText.split(FIRST_LINE_BREAK_PATTERN)[0]?.trim() ?? "";

	if (!firstLine) {
		return undefined;
	}

	const cleaned = firstLine
		.replace(NOTICE_TAG_PATTERN, "")
		.replace(LAYER_PREFIX_PATTERN, "")
		.replace(POLICY_PREFIX_PATTERN, "")
		.replace(TRAILING_BOILERPLATE_PATTERN, "")
		.replace(WHITESPACE_PATTERN, SPACE)
		.trim();

	if (!cleaned) {
		return undefined;
	}

	return cleaned.length > MAX_BLOCK_REASON_LENGTH
		? `${cleaned.slice(0, MAX_BLOCK_REASON_LENGTH - 1)}${ELLIPSIS}`
		: cleaned;
}
