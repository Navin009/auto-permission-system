/**
 * The per-user scratch directory shared by the bash tool and the socket
 * bridges. `tmpdir()` itself is world-writable, so a socket left there can be
 * connected to by any local user; a directory this process owns and keeps at
 * 0700 cannot.
 */

import { chmodSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SCRATCH_DIRECTORY_MODE = 0o700;

/** macOS has /private/tmp, Linux only /tmp. */
function temporaryRoot(): string {
	return existsSync("/private/tmp") ? "/private/tmp" : "/tmp";
}

function currentUserIdentifier(): number {
	return process.getuid?.() ?? 0;
}

/**
 * Create (or adopt) `<root>/pi-<uid>` and return its path. Throws when the path
 * exists but is not a directory owned by this user, so a shared `/tmp` cannot
 * hand over a name this process will then trust.
 */
export function piScratchDirectory(rootDirectory: string = temporaryRoot()): string {
	const directory = join(rootDirectory, `pi-${currentUserIdentifier()}`);

	mkdirSync(directory, { recursive: true, mode: SCRATCH_DIRECTORY_MODE });

	const stats = lstatSync(directory);
	const isOwnedDirectory = stats.isDirectory() && stats.uid === currentUserIdentifier();

	if (!isOwnedDirectory) {
		throw new Error(`${directory} is not a directory owned by the current user`);
	}

	// `mode` on mkdir is masked by the umask, so the owner-only bit is set again.
	chmodSync(directory, SCRATCH_DIRECTORY_MODE);

	return directory;
}
