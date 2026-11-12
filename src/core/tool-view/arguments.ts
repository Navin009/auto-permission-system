import { isCommandTool } from "./labels.ts";

const COMMAND_ARGUMENT = "command";

type ToolCallArguments = Record<string, unknown> | undefined;

export function callCommand(toolName: string, args: ToolCallArguments): string | undefined {
	if (!isCommandTool(toolName)) {
		return undefined;
	}

	const rawCommand = args ? args[COMMAND_ARGUMENT] : undefined;

	return typeof rawCommand === "string" && rawCommand.trim() ? rawCommand : undefined;
}
