export interface ToolLabel {
	verb: string;
	noun: string;
	showsCommandLine: boolean;
	showsExpandHint: boolean;
}

export const TOOL_LABELS: Readonly<Record<string, ToolLabel>> = {
	bash: { verb: "Running", noun: "command", showsCommandLine: true, showsExpandHint: false },
	powershell: { verb: "Running", noun: "command", showsCommandLine: true, showsExpandHint: false },
	codemode: { verb: "Running", noun: "codemode", showsCommandLine: false, showsExpandHint: false },
	read: { verb: "Reading", noun: "file", showsCommandLine: false, showsExpandHint: true },
	edit: { verb: "Editing", noun: "file", showsCommandLine: false, showsExpandHint: true },
	ls: { verb: "Listing", noun: "directory", showsCommandLine: false, showsExpandHint: true },
	grep: { verb: "Searching", noun: "pattern", showsCommandLine: false, showsExpandHint: true },
	find: { verb: "Finding", noun: "pattern", showsCommandLine: false, showsExpandHint: true },
};

export function toolLabelFor(toolName: string): ToolLabel | undefined {
	return TOOL_LABELS[toolName];
}

export function ownsTool(toolName: string): boolean {
	return Object.hasOwn(TOOL_LABELS, toolName);
}
