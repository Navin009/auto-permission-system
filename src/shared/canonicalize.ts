import { realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { normalizeUserPath } from "../core/policy/user-path.ts";

export function canonicalize(targetPath: string, workingDirectory: string): string {
	const absolutePath = resolve(workingDirectory, normalizeUserPath(targetPath));
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
