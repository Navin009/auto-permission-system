import { chmodSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SCRATCH_DIRECTORY_MODE = 0o700;

function temporaryRoot(): string {
	return existsSync("/private/tmp") ? "/private/tmp" : "/tmp";
}

function currentUserIdentifier(): number {
	return process.getuid?.() ?? 0;
}

export function piScratchDirectory(rootDirectory: string = temporaryRoot()): string {
	const directory = join(rootDirectory, `pi-${currentUserIdentifier()}`);

	mkdirSync(directory, { recursive: true, mode: SCRATCH_DIRECTORY_MODE });

	const stats = lstatSync(directory);
	const isOwnedDirectory = stats.isDirectory() && stats.uid === currentUserIdentifier();

	if (!isOwnedDirectory) {
		throw new Error(`${directory} is not a directory owned by the current user`);
	}

	chmodSync(directory, SCRATCH_DIRECTORY_MODE);

	return directory;
}
