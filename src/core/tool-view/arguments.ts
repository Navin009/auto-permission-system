import { RowKind, rowKindOf } from "./row-kind.ts";

const COMMAND_ARGUMENT = "command";
const OFFSET_ARGUMENT = "offset";
const LIMIT_ARGUMENT = "limit";
const RANGE_SEPARATOR = ":";
const RANGE_JOINER = "-";
const BLANK = "";
const FIRST_LINE = 1;
const FILE_ARGUMENTS: readonly string[] = ["file_path", "path"];

type ToolCallArguments = Record<string, unknown> | undefined;

export function rowTarget(toolName: string, args: ToolCallArguments): string | undefined {
	const kind = rowKindOf(toolName);

	if (!kind) {
		return undefined;
	}

	if (kind === RowKind.Shell) {
		const command = textArgument(args, COMMAND_ARGUMENT);

		return command?.trim() ? command : undefined;
	}

	const filePath = fileArgument(args);

	if (!filePath?.trim()) {
		return undefined;
	}

	return `${filePath}${readRange(args)}`;
}

function readRange(args: ToolCallArguments): string {
	const offset = numberArgument(args, OFFSET_ARGUMENT);
	const limit = numberArgument(args, LIMIT_ARGUMENT);

	if (offset === undefined && limit === undefined) {
		return BLANK;
	}

	const start = offset ?? FIRST_LINE;
	const lastLine = limit === undefined || limit <= 0 ? undefined : start + limit - 1;

	return `${RANGE_SEPARATOR}${start}${lastLine === undefined ? BLANK : `${RANGE_JOINER}${lastLine}`}`;
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

function numberArgument(args: ToolCallArguments, argumentName: string): number | undefined {
	const argumentValue = args?.[argumentName];
	const numeric = typeof argumentValue === "string" ? Number(argumentValue) : argumentValue;

	return typeof numeric === "number" && Number.isFinite(numeric) ? numeric : undefined;
}
