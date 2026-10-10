/**
 * One line of pi's grep tool output: `path:N: text` for a match,
 * `path-N- text` for a context line. The separator is the same on both sides
 * of the line number, which keeps paths containing `-` or `:` parseable.
 */
const GREP_LINE_RE = /^(.+?)([:-])(\d+)\2 /;

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
	const deniedByPath = new Map<string, boolean>();
	const removedFiles = new Set<string>();
	let removedLines = 0;
	const keptLines: string[] = [];
	for (const line of text.split("\n")) {
		const match = GREP_LINE_RE.exec(line);
		if (match) {
			const printedPath = match[1];
			let denied = deniedByPath.get(printedPath);
			if (denied === undefined) {
				denied = isDenied(printedPath);
				deniedByPath.set(printedPath, denied);
			}
			if (denied) {
				removedLines++;
				removedFiles.add(printedPath);
				continue;
			}
		}
		keptLines.push(line);
	}
	return { text: keptLines.join("\n"), removedLines, removedFiles: [...removedFiles] };
}
