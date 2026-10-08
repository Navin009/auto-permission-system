/** Advanced Secure output gate (ADR-018). Pure: no pi, no fs. */

import { scanToolOutput } from "../detect/index";

export interface Exposure {
	/** Finding types, e.g. ["SECRET_ASSIGNMENT"]. Empty means clean. */
	types: string[];
	/** One block: `subject` then `lineNo: text` per detected line (max 8). */
	hits: string[];
}

const MAX_LINES = 8;
const MAX_LINE_CHARS = 200;

const clip = (s: string) => (s.length > MAX_LINE_CHARS ? `${s.slice(0, MAX_LINE_CHARS)}…` : s);

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
		const shown = matchedIndices.slice(0, MAX_LINES);
		const firstIdx = shown[0];
		const lastIdx = shown[shown.length - 1];
		const moreMatched = matchedIndices.length > MAX_LINES;
		const moreBelow = lastIdx < before.length - 1;
		if (firstIdx > 0) lines.push("        \u2026");
		for (const idx of shown) lines.push(`${idx + 1}: ${clip(before[idx].trim())}`);
		if (moreMatched || moreBelow) lines.push("        \u2026");
	}
	return { types: [...types], hits: lines.length ? [`From     ${subject}\n${lines.join("\n")}`] : [] };
}
