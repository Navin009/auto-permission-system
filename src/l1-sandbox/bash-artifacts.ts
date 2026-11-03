import { existsSync, readdirSync, rmdirSync, statSync, unlinkSync, type Stats } from "node:fs";
import { join } from "node:path";

const BWRAP_READ_ONLY_BIND_PATTERN = /--ro-bind\s+('[^']+'|"[^"]+"|\S+)\s+('[^']+'|"[^"]+"|\S+)/g;
const MAXIMUM_ARTIFACT_CLEANUP_DEPTH = 2;

export function stripNonExistentWorkspaceMounts(wrappedCommand: string, workingDirectory: string): string {
	return wrappedCommand.replace(BWRAP_READ_ONLY_BIND_PATTERN, (fullMatch, rawSource, rawTarget) => {
		const source = rawSource.replace(/^['"]|['"]$/g, "");
		const target = rawTarget.replace(/^['"]|['"]$/g, "");

		const isPlaceholderSource = source === "/dev/null" || source.startsWith("/tmp");
		const isUnderWorkspace = target === workingDirectory || target.startsWith(`${workingDirectory}/`);

		if (isPlaceholderSource && isUnderWorkspace && !existsSync(target)) {
			return "";
		}

		return fullMatch;
	});
}

function removeOrphanedDevice(devicePath: string): void {
	try {
		unlinkSync(devicePath);
	} catch {
		// safe fallback
	}
}

function removeEmptyDirectory(directoryPath: string): void {
	try {
		rmdirSync(directoryPath);
	} catch {
		// safe fallback
	}
}

function processDirectoryEntry(entryPath: string, currentDepth: number): void {
	let entryStats: Stats;

	try {
		entryStats = statSync(entryPath);
	} catch {
		return;
	}

	if (entryStats.isCharacterDevice()) {
		removeOrphanedDevice(entryPath);
		return;
	}

	if (entryStats.isDirectory()) {
		cleanupWorkspaceArtifacts(entryPath, currentDepth + 1);
		removeEmptyDirectory(entryPath);
	}
}

export function cleanupWorkspaceArtifacts(directory: string, currentDepth = 0): void {
	if (currentDepth > MAXIMUM_ARTIFACT_CLEANUP_DEPTH) {
		return;
	}

	let entryNames: string[];

	try {
		entryNames = readdirSync(directory);
	} catch {
		return;
	}

	for (const entryName of entryNames) {
		if (entryName === ".git" || entryName === "node_modules") {
			continue;
		}

		processDirectoryEntry(join(directory, entryName), currentDepth);
	}
}
