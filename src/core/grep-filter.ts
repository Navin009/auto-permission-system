const GREP_LINE_PATTERN = /^(.+?)([:-])(\d+)\2 /;

export interface GrepFilterResult {
	text: string;
	removedLines: number;
	removedFiles: string[];
}

export function filterGrepOutput(
	rawOutputText: string,
	checkIsDenied: (printedPath: string) => boolean,
): GrepFilterResult {
	const denialCacheByPath = new Map<string, boolean>();
	const removedFileNames = new Set<string>();
	const preservedLines: string[] = [];

	let removedLineCount = 0;

	for (const outputLine of rawOutputText.split("\n")) {
		const lineMatch = GREP_LINE_PATTERN.exec(outputLine);

		if (lineMatch) {
			const printedPath = lineMatch[1];
			let isPathDenied = denialCacheByPath.get(printedPath);

			if (isPathDenied === undefined) {
				isPathDenied = checkIsDenied(printedPath);
				denialCacheByPath.set(printedPath, isPathDenied);
			}

			if (isPathDenied) {
				removedLineCount++;
				removedFileNames.add(printedPath);
				continue;
			}
		}

		preservedLines.push(outputLine);
	}

	return {
		text: preservedLines.join("\n"),
		removedLines: removedLineCount,
		removedFiles: [...removedFileNames],
	};
}
