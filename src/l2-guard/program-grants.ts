/**
 * In-memory session grants for the Advanced Secure output gate (ADR-018).
 *
 * When a CLI like `composio` returns output that matches a secret pattern
 * (JWT, OAuth refresh token, etc.), the user can pick "Yes, all <program>
 * output for this session" instead of approving every block. The program id
 * is added here, and the output gate short-circuits for the rest of the
 * session — same shape as path/host session grants, but for tool output.
 *
 * Cleared at session_start (ADR-010), never written to disk. The credential
 * tier (denyRead / askRead) still wins on the file side; this only loosens
 * the *output* gate, which is about display, not access.
 */

/** The binary / MCP server / tool that produced the output. Case-folded. */
const programOutputSessionGrants = new Set<string>();

export function clearProgramOutputSessionGrants(): void {
	programOutputSessionGrants.clear();
}

/** Add a program to the session grant list. Idempotent. */
export function grantProgramOutputSession(programId: string): void {
	programOutputSessionGrants.add(programId.toLowerCase());
}

/** True when the program is already granted for the rest of the session. */
export function isProgramOutputGranted(programId: string | undefined): boolean {
	if (!programId) return false;
	return programOutputSessionGrants.has(programId.toLowerCase());
}

export function programOutputSessionGrantSummary(): string {
	return [...programOutputSessionGrants].join(", ");
}