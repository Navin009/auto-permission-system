/**
 * Did the user name this file in one of their own messages? (ADR-012)
 *
 * Used for reads outside the project in interactive sessions: a read of a
 * path the user named runs without a prompt. Only session entries with role
 * "user" count; assistant text, tool results and file contents never do, so
 * content the agent read cannot name a path for the user.
 *
 * No pi imports: security/tests/user-named.mjs imports this file directly.
 */

import { basename, isAbsolute, relative } from "node:path";

const MAX_USER_MESSAGES = 20;

type Entry = { type?: string; message?: { role?: string; content?: unknown } };

/** The user's own messages, oldest first. Only "message" entries with role "user"; image parts dropped. */
export function extractUserMessages(entries: readonly unknown[], max = MAX_USER_MESSAGES): string[] {
	const out: string[] = [];
	for (const raw of entries) {
		const e = raw as Entry;
		if (e?.type !== "message" || e.message?.role !== "user") continue;
		const c = e.message.content;
		let text = "";
		if (typeof c === "string") text = c;
		else if (Array.isArray(c)) {
			text = c
				.filter((p): p is { type: "text"; text: string } => !!p && (p as { type?: string }).type === "text" && typeof (p as { text?: unknown }).text === "string")
				.map((p) => p.text)
				.join("\n");
		}
		if (text.trim()) out.push(text);
	}
	return out.slice(-max);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A name is a whole token: not glued to other path or word characters. A
// trailing "." counts as sentence punctuation only before whitespace or the
// end, so ".env" does not match ".env.example" but does match "read .env."
const BEFORE = String.raw`(?<=^|[\s"'\`(\[<{,;=])`;
const AFTER = String.raw`(?=$|[\s"'\`)\]>},;:!?]|\.(?:$|\s))`;

function containsToken(text: string, token: string, caseInsensitive: boolean): boolean {
	return new RegExp(`${BEFORE}${escapeRe(token)}${AFTER}`, caseInsensitive ? "i" : "").test(text);
}

/** Basenames shorter than this are too ambiguous to count as "named" ("a", "go"). */
const MIN_BASENAME = 3;

export interface FileTarget {
	/** Canonical absolute path (symlinks resolved). */
	canonical: string;
	/** Absolute path as the tool call spelled it, before symlink resolution (e.g. /tmp vs /private/tmp). */
	spelled?: string;
	/** Canonical project root. */
	cwd: string;
	home: string;
}

/**
 * Which spelling of a file the user named, or null.
 *
 * Inside the project: its relative path (also as `./rel`) or its basename.
 * Outside the project: only its full path, absolute or `~/…`. A bare basename
 * is not enough there, so "check .env" cannot open some other repo's `.env`.
 */
export function userNamedFile(messages: string[], t: FileTarget, caseInsensitive = process.platform === "darwin"): string | null {
	const forms = new Set<string>();
	for (const abs of [t.canonical, t.spelled].filter((p): p is string => !!p && isAbsolute(p))) {
		forms.add(abs);
		if (abs === t.home || abs.startsWith(`${t.home}/`)) forms.add(`~${abs.slice(t.home.length)}`);
	}
	const rel = relative(t.cwd, t.canonical);
	if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
		// A top-level file's relative path is its basename: same length rule.
		if (rel.includes("/") || rel.length >= MIN_BASENAME) forms.add(rel);
		forms.add(`./${rel}`);
		const base = basename(t.canonical);
		if (base.length >= MIN_BASENAME) forms.add(base);
	}
	for (const m of messages) for (const f of forms) if (containsToken(m, f, caseInsensitive)) return f;
	return null;
}
