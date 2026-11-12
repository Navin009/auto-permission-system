export const RowKind = {
	Shell: "shell",
	Read: "read",
} as const;
export type RowKind = (typeof RowKind)[keyof typeof RowKind];

export interface RowKindLabel {
	verb: string;
	noun: string;
	showsChildLines: boolean;
}

const SHELL_LABEL: RowKindLabel = { verb: "Running", noun: "command", showsChildLines: true };
const READ_LABEL: RowKindLabel = { verb: "Reading", noun: "file", showsChildLines: false };

const KIND_BY_TOOL_NAME: ReadonlyMap<string, RowKind> = new Map([
	["bash", RowKind.Shell],
	["powershell", RowKind.Shell],
	["read", RowKind.Read],
]);

const LABEL_BY_KIND: Readonly<Record<RowKind, RowKindLabel>> = {
	[RowKind.Shell]: SHELL_LABEL,
	[RowKind.Read]: READ_LABEL,
};

export function rowKindOf(toolName: string): RowKind | undefined {
	return KIND_BY_TOOL_NAME.get(toolName);
}

export function rowLabelOf(kind: RowKind): RowKindLabel {
	return LABEL_BY_KIND[kind];
}
