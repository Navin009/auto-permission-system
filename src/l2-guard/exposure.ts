/** Advanced Secure output gate (ADR-018, ADR-042). Pure: no pi, no fs. */

import { scanToolOutput } from "../detect/index";

export interface Exposure {
	/** Finding types, e.g. ["SECRET_ASSIGNMENT"]. Empty means clean. */
	types: string[];
	/** One block: `Tool` header then `Finding  <lineNo>: <line>` per detected line. */
	hits: string[];
}

const ROW_LABEL = {
	tool: "Tool     ",
	finding: "Finding  ",
};

/**
 * A data block (an image, a base64 attachment) carries bytes the text scanner
 * never sees, so it is reported as unscannable rather than forwarded silently.
 * `read` is the one tool that returns such blocks on purpose, so it is exempt.
 */
const NON_TEXT_TYPE = "NON_TEXT_OUTPUT";

export interface ExposureOptions {
	flagNonText?: boolean;
}

function nonTextRow(block: { type: string; mimeType?: string; data?: string }): string {
	const label = block.mimeType ?? block.type;
	const byteCount = block.data?.length ?? 0;

	return `${ROW_LABEL.finding}${label} payload, ${byteCount} bytes, not scannable`;
}

export function collectExposure(
	content: ReadonlyArray<{ type: string; text?: string; data?: string; mimeType?: string }>,
	subject: string,
	options?: ExposureOptions,
): Exposure {
	const types = new Set<string>();
	const evidenceRows: string[] = [];
	const findingRows = new Set<string>();

	for (const block of content) {
		if (block.type !== "text" || typeof block.text !== "string") {
			if (options?.flagNonText && typeof block.data === "string" && block.data.length > 0) {
				types.add(NON_TEXT_TYPE);
				findingRows.add(nonTextRow(block));
			}

			continue;
		}

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
				evidenceRows.push(`${ROW_LABEL.finding}${index + 1}: ${rawLine}`);
			}
		}

		if (locatedCount > 0) continue;

		for (const finding of scan.findings) {
			const preview = finding.preview ? `: ${finding.preview}` : "";
			findingRows.add(`${ROW_LABEL.finding}${finding.label}${preview}`);
		}
	}

	const visibleRows = evidenceRows.length > 0 ? evidenceRows : [...findingRows];

	if (types.size === 0 || visibleRows.length === 0) return { types: [...types], hits: [] };

	const lines = [`${ROW_LABEL.tool}${subject}`, ...visibleRows];

	return { types: [...types], hits: [lines.join("\n")] };
}
