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
 * Create (or adopt) `<root>/pi-<uid>` and return its path.
 *
 * Throws instead of falling back to the world-writable parent: a silent
 * fallback would put the bridge sockets back where any local user can reach
 * them. A pre-existing path that is a symlink, a file, or owned by someone
 * else is rejected for the same reason — `/tmp` is shared, so the name being
 * free is not the same as the name being ours.
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
