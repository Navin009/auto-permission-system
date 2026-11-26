import type { RowKind } from "./row-kind.ts";
import { statusWord, ToolStatus } from "./status.ts";
import type { ThinkingState } from "./thinking.ts";

export type SpanTone = "title" | "text" | "muted" | "dim" | "thinking" | "accent" | "success" | "warning" | "error";

export interface RowSpan {
	text: string;
	tone: SpanTone;
	bold?: boolean;
	italic?: boolean;
}

export interface SubLineSummary {
	text: string;
	status: ToolStatus | undefined;
	kind?: "script" | "call";
	detail?: string;
}

export interface RowSummary {
	kind?: RowKind;
	target: string;
	status: ToolStatus;
	segmentIndex: number;
	hint?: string;
	subLines?: readonly SubLineSummary[];
	note?: string;
}

export interface RowGroupSummary {
	kind: RowKind;
	rows: readonly RowSummary[];
	durationMilliseconds: number | undefined;
	folded: boolean;
	hint: string | undefined;
	thinking: ThinkingState | undefined;
	spinnerFrame?: number;
	cwd?: string;
	homeDirectory?: string;
	groupOpenHint?: string;
}

export interface RowMark {
	glyph: string;
	status: ToolStatus;
}

export interface RowLine {
	indent: string;
	mark: RowMark | undefined;
	text: string;
	spans?: readonly RowSpan[];
	duration: string | undefined;
	hint: string | undefined;
	isDim: boolean;
	isWarning?: boolean;
	memberIndex?: number;
	segmentIndex?: number;
}

export interface StyledText {
	text: string;
	spans: RowSpan[];
}

export interface IssueSummary {
	label: string;
	tone: SpanTone;
}

export const HINT_SEPARATOR = "   ";
export const FOLDED_NOTE_BADGE = "[notice]";
export const SPACE = " ";
export const BLANK = "";
export const ELLIPSIS = "…";
export const PATH_SEPARATOR = "/";
export const MARK_COLUMN_WIDTH = 2;
export const SINGLE_ROW_COUNT = 1;
export const DRAWING_MEMBER_INDEX = 0;
const PLURAL_ENDING = "s";
const PLURAL_Y_ENDING = "ies";
const WHITESPACE_PATTERN = /\s+/g;

export function pluralize(noun: string, count: number): string {
	if (count === SINGLE_ROW_COUNT) {
		return noun;
	}

	return noun.endsWith("y") ? `${noun.slice(0, -1)}${PLURAL_Y_ENDING}` : `${noun}${PLURAL_ENDING}`;
}

export function markColumnWidth(mark: RowMark | undefined): number {
	return mark ? MARK_COLUMN_WIDTH : 0;
}

export function wordText(status: ToolStatus, isShown: boolean): string {
	const word = isShown ? statusWord(status) : undefined;

	return word ? `${SPACE}${word}` : BLANK;
}

export function wordTone(status: ToolStatus): SpanTone {
	if (status === ToolStatus.Blocked) {
		return "warning";
	}

	return status === ToolStatus.Denied ? "error" : "text";
}

export function summarizeIssues(rows: readonly RowSummary[]): IssueSummary | undefined {
	let failed = 0;
	let blocked = 0;
	let denied = 0;

	for (const row of rows) {
		if (row.status === ToolStatus.Failed) {
			failed += 1;
		} else if (row.status === ToolStatus.Blocked) {
			blocked += 1;
		} else if (row.status === ToolStatus.Denied) {
			denied += 1;
		}
	}

	const total = failed + blocked + denied;

	if (total === 0) {
		return undefined;
	}

	if (failed === total) {
		return { label: `${failed} failed`, tone: "error" };
	}

	if (blocked === total) {
		return { label: `${blocked} blocked`, tone: "warning" };
	}

	if (denied === total) {
		return { label: `${denied} denied`, tone: "error" };
	}

	return { label: `${total} ${pluralize("issue", total)}`, tone: "error" };
}

export function activeIssueSummary(rows: readonly RowSummary[], status: ToolStatus): IssueSummary | undefined {
	if (status !== ToolStatus.Ok && status !== ToolStatus.Running) {
		return undefined;
	}

	return summarizeIssues(rows);
}

export function hasAnyNote(rows: readonly RowSummary[]): boolean {
	return rows.some((row) => Boolean(row.note));
}

export function toSingleLine(text: string): string {
	return text.replace(WHITESPACE_PATTERN, SPACE).trim();
}

export function rowEffectiveKind(summary: RowGroupSummary, row: RowSummary): RowKind {
	return row.kind ?? summary.kind;
}

export function isMixedBatch(summary: RowGroupSummary): boolean {
	const firstRow = summary.rows[0];
	const firstKind = firstRow ? rowEffectiveKind(summary, firstRow) : summary.kind;

	return summary.rows.some((row) => rowEffectiveKind(summary, row) !== firstKind);
}
