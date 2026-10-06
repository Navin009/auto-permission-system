/**
 * One line of pi's grep tool output: `path:N: text` for a match,
 * `path-N- text` for a context line. The separator is the same on both sides
 * of the line number, which keeps paths containing `-` or `:` parseable.
 */
const GREP_LINE = /^(.+?)([:-])(\d+)\2 /;

export interface GrepFilterResult {
	text: string;
	removedLines: number;
	removedFiles: string[];
}

/**
 * Remove grep output lines that come from denied files.
 *
 * `isDenied` receives the path exactly as grep printed it (relative to the
 * search root for a directory search). Lines that are not match or context
 * lines (`--` separators, truncation notices) are kept. Decisions are cached
 * per path.
 */
export function filterGrepOutput(text: string, isDenied: (printedPath: string) => boolean): GrepFilterResult {
	const cache = new Map<string, boolean>();
	const removedFiles = new Set<string>();
	let removedLines = 0;
	const kept: string[] = [];
	for (const line of text.split("\n")) {
		const m = GREP_LINE.exec(line);
		if (m) {
			const file = m[1];
			let denied = cache.get(file);
			if (denied === undefined) {
				denied = isDenied(file);
				cache.set(file, denied);
			}
			if (denied) {
				removedLines++;
				removedFiles.add(file);
				continue;
			}
		}
		kept.push(line);
	}
	return { text: kept.join("\n"), removedLines, removedFiles: [...removedFiles] };
}
