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

/** `mcp__<server>__<tool>` → server name. Underscores are allowed in server names
 *  (e.g. `mcp__composio_io__search` → `composio_io`). Returns undefined for non-MCP tools. */
export function mcpServer(toolName: string): string | undefined {
	if (!toolName.startsWith("mcp__")) return undefined;
	const parts = toolName.split("__");
	if (parts.length < 3 || parts[0] !== "mcp") return undefined;
	return parts[1];
}

/** The program id for a tool call. Falls back to the tool name when the binary
 *  can't be inferred. Returns undefined only when both tool name and input are empty. */
export function programIdForToolCall(toolName: string | undefined, input: unknown): string | undefined {
	if (!toolName) return undefined;
	if (toolName === "bash") {
		const cmd = (input as { command?: string } | undefined)?.command;
		const bin = bashBinary(cmd);
		if (bin) return bin;
	}
	const server = mcpServer(toolName);
	if (server) return server;
	return toolName;
}