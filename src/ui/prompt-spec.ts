export type FieldTone = "default" | "dim" | "warning" | "muted";

export interface PromptField {
	label: string;
	value: string;
	tone?: FieldTone;
}

export interface PromptFinding {
	prefix: string;
	text: string;
}

export interface AskOptionItem {
	value: string;
	label: string;
	description?: string;
	key?: string;
	fallbackLabel?: string;
}

export type PromptOption = string | AskOptionItem;

export interface PromptBody {
	fields: readonly PromptField[];
	findings?: readonly PromptFinding[];
}

export const FIELD_COLUMN_WIDTH = 9;
const WARNING_LABELS = new Set(["Why", "Risk"]);
const DIM_LABELS = new Set(["Folder"]);
const MUTED_LABELS = new Set(["Note"]);

export function fieldToneOf(label: string, override?: FieldTone): FieldTone {
	if (override) {
		return override;
	}

	if (WARNING_LABELS.has(label)) {
		return "warning";
	}

	if (DIM_LABELS.has(label)) {
		return "dim";
	}

	if (MUTED_LABELS.has(label)) {
		return "muted";
	}

	return "default";
}

export function promptField(label: string, value: string, tone?: FieldTone): PromptField {
	return { label, value, tone: fieldToneOf(label, tone) };
}

export function formatPromptFieldLine(field: PromptField, labelWidth = FIELD_COLUMN_WIDTH): string {
	return `${field.label.padEnd(labelWidth)}${field.value}`;
}

export function formatPromptBodyLines(body: PromptBody): string[] {
	const maxLabel = body.fields.reduce((max, field) => Math.max(max, field.label.length + 2), FIELD_COLUMN_WIDTH);
	const lines = body.fields.map((field) => formatPromptFieldLine(field, maxLabel));

	for (const finding of body.findings ?? []) {
		lines.push(`${finding.prefix}${finding.text}`);
	}

	return lines;
}

export function normalizeAskOption(option: PromptOption): AskOptionItem {
	if (typeof option === "string") {
		return { value: option, label: option };
	}

	return option;
}
