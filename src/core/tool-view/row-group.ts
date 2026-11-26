import { buildChildLines } from "./child-lines.ts";
import { buildHeaderLine, headerStatus } from "./header-lines.ts";
import { isMixedBatch, type RowGroupSummary, type RowLine } from "./row-group-types.ts";
import { rowLabelOf } from "./row-kind.ts";

export {
	HINT_SEPARATOR,
	pluralize,
	type RowGroupSummary,
	type RowLine,
	type RowMark,
	type RowSpan,
	type RowSummary,
	type SpanTone,
	type SubLineSummary,
} from "./row-group-types.ts";

const DRAWING_MEMBER_INDEX = 0;

export function rowGroupLines(summary: RowGroupSummary, width: number): RowLine[] {
	const showsChildLines = isMixedBatch(summary) || rowLabelOf(summary.kind).showsChildLines;
	const foldedHint = summary.folded || !showsChildLines;
	const status = headerStatus(summary);
	const header = buildHeaderLine(summary, status, foldedHint, width);

	if (summary.folded) {
		return [header];
	}

	return [header, ...buildChildLines(summary, width, showsChildLines)];
}

export function rowGroupLinesForMember(summary: RowGroupSummary, width: number, memberIndex: number): RowLine[] {
	return rowGroupLines(summary, width).filter((line) => (line.memberIndex ?? DRAWING_MEMBER_INDEX) === memberIndex);
}

export function rowGroupLinesForSegment(summary: RowGroupSummary, width: number, segmentIndex: number): RowLine[] {
	return rowGroupLines(summary, width).filter((line) => (line.segmentIndex ?? DRAWING_MEMBER_INDEX) === segmentIndex);
}
