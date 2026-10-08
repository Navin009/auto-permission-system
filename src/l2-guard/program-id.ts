/**
 * Program-id detection for the Advanced Secure output gate.
 *
 * Used to label the "This output may contain a secret" prompt with the binary
 * that produced it (`composio`, `aws`, `gcloud`, …) and to key the per-program
 * session grant (`isProgramOutputGranted`). Pure functions, no pi / fs / audit.
 */

/** Strip env assignments (`FOO=bar`), common wrappers (sudo, nice, command, …), and the
 *  flags they take to find the real binary name in a bash command. Handles `nice -n 10`,
 *  `sudo -u user -- composio`, `command -v`, `strace -f -o /tmp/log aws s3 ls`, etc.
 *  Returns undefined for empty input. */
export function bashBinary(command: string | undefined): string | undefined {
	if (!command) return undefined;
	const tokens = command.trim().split(/\s+/).filter(Boolean);
	let i = 0;
	while (i < tokens.length && /^[A-Z_][A-Z0-9_]*=/.test(tokens[i])) i++;
	const WRAPPERS = new Set(["sudo", "nice", "command", "time", "strace", "stdbuf", "timeout"]);
	while (i < tokens.length) {
		if (WRAPPERS.has(tokens[i])) { i++; continue; }
		if (tokens[i] === "-n" && i + 1 < tokens.length && /^\d+$/.test(tokens[i + 1])) { i += 2; continue; }
		if (tokens[i].startsWith("-") && tokens[i].length > 1) { i++; continue; }
		break;
	}
	return tokens[i];
}

/** The program id for a tool call. Bash binaries only — MCP and other tools return
 *  `undefined` so the Advanced Secure output gate doesn't offer them a per-program
 *  session grant (MCP tools handle their own secrets and don't share the
 *  composio-style "same binary, same surface" pattern). */
export function programIdForToolCall(toolName: string | undefined, input: unknown): string | undefined {
	if (!toolName) return undefined;
	if (toolName !== "bash") return undefined;
	const cmd = (input as { command?: string } | undefined)?.command;
	return bashBinary(cmd);
}