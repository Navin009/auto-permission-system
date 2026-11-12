import { RowKind, rowKindOf } from "./row-kind.ts";

const COMMAND_ARGUMENT = "command";
const FILE_ARGUMENTS: readonly string[] = ["file_path", "path"];

type ToolCallArguments = Record<string, unknown> | undefined;

export function rowTarget(toolName: string, args: ToolCallArguments): string | undefined {
	const kind = rowKindOf(toolName);

	if (!kind) {
		return undefined;
	}

	const rawTarget = kind === RowKind.Shell ? textArgument(args, COMMAND_ARGUMENT) : fileArgument(args);

	return rawTarget?.trim() ? rawTarget : undefined;
}

function fileArgument(args: ToolCallArguments): string | undefined {
	for (const argumentName of FILE_ARGUMENTS) {
		const argumentValue = textArgument(args, argumentName);

		if (argumentValue?.trim()) {
			return argumentValue;
		}
	}

	return undefined;
}

function textArgument(args: ToolCallArguments, argumentName: string): string | undefined {
	const argumentValue = args?.[argumentName];

	return typeof argumentValue === "string" ? argumentValue : undefined;
}
