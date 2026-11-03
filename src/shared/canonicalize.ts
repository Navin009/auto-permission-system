import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";

export function canonicalize(targetPath: string, workingDirectory: string): string {
	const absolutePath = isAbsolute(targetPath) ? targetPath : resolve(workingDirectory, targetPath);
	const unresolvableSuffixComponents: string[] = [];

	let currentPath = absolutePath;

	while (true) {
		try {
			const resolvedPath = realpathSync(currentPath);

			if (unresolvableSuffixComponents.length === 0) {
				return resolvedPath;
			}

			const reversedSuffix = unresolvableSuffixComponents
				.reduceRight((combinedPath, component) => `${combinedPath}/${component}`);
			return `${resolvedPath}/${reversedSuffix}`;
		} catch {
			const parentDirectory = dirname(currentPath);

			if (parentDirectory === currentPath) {
				return absolutePath;
			}

			unresolvableSuffixComponents.push(basename(currentPath));
			currentPath = parentDirectory;
		}
	}
}
