const COMMAND_TOOLS: ReadonlySet<string> = new Set(["bash", "powershell"]);

export function isCommandTool(toolName: string): boolean {
	return COMMAND_TOOLS.has(toolName);
}
