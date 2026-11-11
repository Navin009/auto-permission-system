import { toolLabelFor } from "./labels.ts";

const TARGET_ARGUMENT_BY_TOOL: Readonly<Record<string, string>> = {
	read: "path",
	edit: "path",
	ls: "path",
	grep: "pattern",
	find: "pattern",
};

const COMMAND_ARGUMENT = "command";
const PATH_SEPARATOR = "/";

type ToolCallArguments = Record<string, unknown> | undefined;

export function callTarget(toolName: string, args: ToolCallArguments): string | undefined {
	const argumentName = TARGET_ARGUMENT_BY_TOOL[toolName];
	const rawTarget = argumentName && args ? args[argumentName] : undefined;

	return typeof rawTarget === "string" && rawTarget.trim() ? rawTarget : undefined;
}

export function callCommand(toolName: string, args: ToolCallArguments): string | undefined {
	const label = toolLabelFor(toolName);
	if (!label?.showsCommandLine) {
		return undefined;
	}

	const rawCommand = args ? args[COMMAND_ARGUMENT] : undefined;

	return typeof rawCommand === "string" && rawCommand.trim() ? rawCommand : undefined;
}

export function shortenTarget(target: string, cwd: string, homeDirectory: string): string {
	if (target === cwd) {
		return ".";
	}

	if (target.startsWith(`${cwd}${PATH_SEPARATOR}`)) {
		return target.slice(cwd.length + 1);
	}

	if (target.startsWith(`${homeDirectory}${PATH_SEPARATOR}`)) {
		return `~${target.slice(homeDirectory.length)}`;
	}

	return target;
}
