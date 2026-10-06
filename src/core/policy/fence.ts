import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { matchesPolicyPattern, normalizeAbs, toSandboxPatterns } from "./patterns";
import { type FilesystemPolicy, outsideProjectMode, outsideProjectReadDenied } from "./classify";

// ---------- Layer 1 pre-flight ask (ADR-015) ----------

/**
 * Commands whose positional arguments are read targets. Layer 1's pre-flight
 * ask only inspects segments whose head is one of these, so `echo ~/.pi/agent`
 * (a literal, not a read) does not prompt. `cd` is included because the
 * segment after it reads relative to the directory it names.
 */
const READ_COMMANDS = new Set([
	"ls", "cat", "find", "grep", "rg", "fd", "head", "tail", "stat", "file",
	"tree", "wc", "readlink", "realpath", "sed", "awk", "less", "more", "du",
	"bat", "nl", "strings", "xxd", "od", "cd", "pushd", "popd", "dirname", "basename",
]);

/** Split a shell command on the operators that start a new simple command. */
function shellSegments(command: string): string[] {
	return command.split(/\s*(?:;|&&|\|\||\||\n)\s*/).map((s) => s.trim()).filter(Boolean);
}

/** Tokenize one segment, dropping the quotes around fully quoted words. */
function shellTokens(segment: string): string[] {
	const out: string[] = [];
	const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(segment))) out.push(m[1] ?? m[2] ?? m[3] ?? "");
	return out;
}

/** A token that could name a path, expanded (`~`) but not yet resolved. */
function expandPathToken(token: string, home: string): string | undefined {
	const t = token.trim();
	if (!t || t.startsWith("-")) return undefined;
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return undefined; // URL, not a path
	if (t === "~") return home;
	if (t.startsWith("~/")) return `${home}/${t.slice(2)}`;
	const looksLikePath = t.startsWith("/") || t.startsWith("./") || t.startsWith("../") || t.includes("/");
	return looksLikePath ? t : undefined;
}

/**
 * Absolute paths a bash command **plainly** reads that are outside the project
 * and not already allowed (Layer 1 ask-tier, ADR-015). Best-effort: only
 * read-like segments, only tokens that exist on disk, never a hard `denyRead`
 * match. Obfuscated reads are not returned; the sidecar fence still covers
 * those, so the pre-flight ask is an improvement over silent masking, not a
 * replacement for the OS boundary.
 */
export function outsideProjectReadCandidates(
	command: string,
	cwd: string,
	home: string,
	fs: FilesystemPolicy,
	exists: (path: string) => boolean = existsSync,
): string[] {
	const found = new Set<string>();
	for (const segment of shellSegments(command)) {
		const tokens = shellTokens(segment);
		const head = (tokens[0] ?? "").split("/").pop() ?? "";
		if (!READ_COMMANDS.has(head)) continue;
		for (const raw of tokens.slice(1)) {
			const expanded = expandPathToken(raw, home);
			if (!expanded) continue;
			const abs = expanded.startsWith("/")
				? normalizeAbs(expanded)
				: normalizeAbs(`${cwd.replace(/\/+$/, "")}/${expanded}`);
			if (!exists(abs)) continue;
			if (fs.denyRead.some((pat) => matchesPolicyPattern(abs, pat, cwd, home))) continue;
			if (!outsideProjectReadDenied(abs, cwd, home, fs)) continue;
			found.add(abs);
		}
	}
	return [...found];
}

/**
 * Build the `filesystem` block handed to sandbox-runtime (Layer 1).
 *
 * When the policy gates outside-project reads, sandbox-runtime has no
 * interactive prompt, so the boundary is enforced by fencing the home
 * directory (and the project's parent when it is not under home) with
 * `denyRead` and then re-exposing the project and the allowed roots with
 * `allowRead` — the runtime resolves `allowRead` as a re-allow *within* a
 * denied region. Explicit file denies keep winning over a directory
 * `allowRead`, so `.env` / `*.pem` / `~/.ssh` stay blocked. Without this,
 * `outsideProject` never reached Layer 1 at all and `bash` read anything.
 */
export function sandboxFilesystem(
	fs: FilesystemPolicy,
	opts: { cwd: string; home: string },
): { denyRead: string[]; allowRead: string[]; allowWrite: string[]; denyWrite: string[] } {
	const denyRead = toSandboxPatterns(fs.denyRead);
	const allowRead = toSandboxPatterns(fs.allowRead ?? []);
	if (outsideProjectMode(fs) !== "allow") {
		for (const fence of [opts.home, dirname(opts.cwd)]) {
			if (fence && fence !== "/" && !denyRead.includes(fence)) denyRead.push(fence);
		}
		const grants = [opts.cwd, ...fs.allowWrite, ...(fs.outsideProject?.allowRead ?? [])];
		for (const grant of grants) {
			const p = toSandboxPatterns([grant])[0];
			if (!allowRead.includes(p)) allowRead.push(p);
		}
	}
	return { denyRead, allowRead, allowWrite: [...fs.allowWrite], denyWrite: toSandboxPatterns(fs.denyWrite) };
}
