import { matchesPolicyPattern } from "./patterns.ts";

export const ReadPosture = {
	Allow: "allow",
	Ask: "ask",
	Deny: "deny",
} as const;

export type ReadPosture = (typeof ReadPosture)[keyof typeof ReadPosture];

export interface FilesystemPolicy {
	denyRead: readonly string[];
	allowWrite: readonly string[];
	denyWrite: readonly string[];
	allowRead?: readonly string[];
	askRead?: readonly string[];
	outsideProject?: { read?: ReadPosture; allowRead?: string[] };
}

export function outsideProjectMode(filesystem: FilesystemPolicy): ReadPosture {
	return filesystem.outsideProject?.read ?? ReadPosture.Allow;
}

export function outsideProjectReadDenied(
	absolutePath: string,
	workingDirectory: string,
	homeDirectory: string,
	filesystem: FilesystemPolicy,
): boolean {
	if (outsideProjectMode(filesystem) === ReadPosture.Allow) {
		return false;
	}

	if (absolutePath === workingDirectory || absolutePath.startsWith(`${workingDirectory}/`)) {
		return false;
	}

	const allowedPatterns = [
		...filesystem.allowWrite,
		...(filesystem.allowRead ?? []),
		...(filesystem.outsideProject?.allowRead ?? []),
	];

	const isAllowed = allowedPatterns.some((pattern) =>
		matchesPolicyPattern(absolutePath, pattern, workingDirectory, homeDirectory),
	);

	return !isAllowed;
}
