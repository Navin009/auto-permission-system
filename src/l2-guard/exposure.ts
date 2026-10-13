/** Advanced Secure output gate (ADR-018). Pure: no pi, no fs. */

import { scanToolOutput } from "../detect/index";

export interface Exposure {
	/** Finding types, e.g. ["SECRET_ASSIGNMENT"]. Empty means clean. */
	types: string[];
	/** One block: `Tool` header then `Finding  <lineNo>: <line>` per detected line. */
	hits: string[];
}

export function collectExposure(content: ReadonlyArray<{ type: string; text?: string }>, subject: string): Exposure {
	const types = new Set<string>();
	const lines: string[] = [];
	for (const c of content) {
		if (c.type !== "text" || typeof c.text !== "string") continue;
		const r = scanToolOutput({ output: c.text });
		if (r.decision !== "ask") continue;
		for (const f of r.findings) types.add(f.type);
		const before = c.text.split("\n");
		const after = String(r.redactedOutput ?? "").split("\n");
		const matchedIndices: number[] = [];
		for (let i = 0; i < before.length; i++) {
			if (after[i] !== before[i] && before[i].trim()) matchedIndices.push(i);
		}
		if (matchedIndices.length === 0) continue;
		lines.push(`Tool     ${subject}`);
		// One `Finding` row per detected line, showing the complete line (no clipping).
		for (const idx of matchedIndices) lines.push(`Finding  ${idx + 1}: ${before[idx].trim()}`);
	}
	return { types: [...types], hits: lines.length ? [lines.join("\n")] : [] };
}
