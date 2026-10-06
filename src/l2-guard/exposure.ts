/**
 * Advanced Secure output gate (ADR-018).
 *
 * Scans the text blocks of any tool result — bash `cat`, `read`, `grep`, an MCP
 * result — and returns the finding types plus the detected lines, so the caller
 * can ask before any of it reaches the model. Pure: no pi, no fs.
 */

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
		for (let i = 0; i < before.length && lines.length < MAX_LINES; i++) {
			if (after[i] !== before[i] && before[i].trim()) lines.push(`${i + 1}: ${clip(before[i].trim())}`);
		}
	}
	return { types: [...types], hits: lines.length ? [`${subject}\n${lines.join("\n")}`] : [] };
}
