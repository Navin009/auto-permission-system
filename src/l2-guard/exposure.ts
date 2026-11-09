/** Advanced Secure output gate (ADR-018, ADR-040). Pure: no pi, no fs. */

import { scanToolOutput } from "../detect/index";

export interface Exposure {
	/** Finding types, e.g. ["SECRET_ASSIGNMENT"]. Empty means clean. */
	types: string[];
	/** One block: `Tool` header then `Finding  <lineNo>: <line>` per detected line. */
	hits: string[];
}

const MAX_EVIDENCE_WIDTH = 160;
const MAX_EVIDENCE_ROWS = 10;
const ELLIPSIS = "\u2026";

const ROW_LABEL = {
	tool: "Tool     ",
	finding: "Finding  ",
	hidden: "Hidden   ",
};

function findFirstDifference(before: string, redacted: string): number {
	const shortestLength = Math.min(before.length, redacted.length);

	for (let index = 0; index < shortestLength; index++) {
		if (before[index] !== redacted[index]) return index;
	}

	return shortestLength;
}

function clipLineAround(line: string, anchor: number): string {
	if (line.length <= MAX_EVIDENCE_WIDTH) return line;

	const windowWidth = MAX_EVIDENCE_WIDTH - ELLIPSIS.length * 2;
	const start = Math.max(0, Math.min(anchor - Math.floor(windowWidth / 2), line.length - windowWidth));
	const end = start + windowWidth;

	const head = start > 0 ? ELLIPSIS : "";
	const tail = end < line.length ? ELLIPSIS : "";

	return `${head}${line.slice(start, end)}${tail}`;
}

export function collectExposure(
	content: ReadonlyArray<{ type: string; text?: string }>,
	subject: string,
): Exposure {
	const types = new Set<string>();
	const evidenceRows: string[] = [];
	const findingRows = new Set<string>();
	let hiddenCount = 0;

	for (const block of content) {
		if (block.type !== "text" || typeof block.text !== "string") continue;

		const scan = scanToolOutput({ output: block.text });

		if (scan.decision !== "ask") continue;

		for (const finding of scan.findings) types.add(finding.type);

		const rawLines = block.text.split("\n");
		const redactedLines = String(scan.redactedOutput ?? "").split("\n");
		const canDiffByIndex = rawLines.length === redactedLines.length;
		let locatedCount = 0;

		if (canDiffByIndex) {
			for (let index = 0; index < rawLines.length; index++) {
				const rawLine = rawLines[index].trim();
				const redactedLine = redactedLines[index].trim();

				if (!rawLine || rawLine === redactedLine) continue;

				locatedCount++;

				if (evidenceRows.length >= MAX_EVIDENCE_ROWS) {
					hiddenCount++;
					continue;
				}

				const anchor = findFirstDifference(rawLine, redactedLine);
				evidenceRows.push(`${ROW_LABEL.finding}${index + 1}: ${clipLineAround(rawLine, anchor)}`);
			}
		}

		if (locatedCount > 0) continue;

		for (const finding of scan.findings) {
			const preview = finding.preview ? `: ${clipLineAround(finding.preview, 0)}` : "";
			findingRows.add(`${ROW_LABEL.finding}${finding.label}${preview}`);
		}
	}

	const visibleRows = evidenceRows.length > 0 ? evidenceRows : [...findingRows];

	if (types.size === 0 || visibleRows.length === 0) return { types: [...types], hits: [] };

	const lines = [`${ROW_LABEL.tool}${subject}`, ...visibleRows];

	if (hiddenCount > 0) lines.push(`${ROW_LABEL.hidden}${hiddenCount} more detected line(s) not shown`);

	return { types: [...types], hits: [lines.join("\n")] };
}
