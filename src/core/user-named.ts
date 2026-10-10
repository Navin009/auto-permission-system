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

interface SessionEntry {
	type?: string;
	message?: { role?: string; content?: unknown };
}

/** The user's own messages, oldest first. Only "message" entries with role "user"; image parts dropped. */
export function extractUserMessages(entries: readonly unknown[], max = MAX_USER_MESSAGES): string[] {
	const messages: string[] = [];
	for (const raw of entries) {
		const entry = raw as SessionEntry;
		if (entry?.type !== "message" || entry.message?.role !== "user") continue;
		const content = entry.message.content;
		let text = "";
		if (typeof content === "string") text = content;
		else if (Array.isArray(content)) {
			text = content
				.filter((part): part is { type: "text"; text: string } => !!part && (part as { type?: string }).type === "text" && typeof (part as { text?: unknown }).text === "string")
				.map((part) => part.text)
				.join("\n");
		}
		if (text.trim()) messages.push(text);
	}
	return messages.slice(-max);
}

const escapeRegExp = (source: string): string => source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A name is a whole token: not glued to other path or word characters. A
 * trailing "." counts as sentence punctuation only before whitespace or the
 * end, so ".env" does not match ".env.example" but does match "read .env."
 */
const TOKEN_BEFORE = String.raw`(?<=^|[\s"'\`(\[<{,;=])`;
const TOKEN_AFTER = String.raw`(?=$|[\s"'\`)\]>},;:!?]|\.(?:$|\s))`;

function containsToken(text: string, token: string, caseInsensitive: boolean): boolean {
	return new RegExp(`${TOKEN_BEFORE}${escapeRegExp(token)}${TOKEN_AFTER}`, caseInsensitive ? "i" : "").test(text);
}

/** Basenames shorter than this are too ambiguous to count as "named" ("a", "go"). */
const MIN_BASENAME_LENGTH = 3;

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
export function userNamedFile(messages: string[], target: FileTarget, caseInsensitive = process.platform === "darwin"): string | null {
	const forms = new Set<string>();
	for (const absolute of [target.canonical, target.spelled].filter((path): path is string => !!path && isAbsolute(path))) {
		forms.add(absolute);
		if (absolute === target.home || absolute.startsWith(`${target.home}/`)) forms.add(`~${absolute.slice(target.home.length)}`);
	}
	const relativePath = relative(target.cwd, target.canonical);
	if (relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath)) {
		if (relativePath.includes("/") || relativePath.length >= MIN_BASENAME_LENGTH) forms.add(relativePath);
		forms.add(`./${relativePath}`);
		const basenameOfPath = basename(target.canonical);
		if (basenameOfPath.length >= MIN_BASENAME_LENGTH) forms.add(basenameOfPath);
	}
	for (const message of messages) for (const form of forms) if (containsToken(message, form, caseInsensitive)) return form;
	return null;
}
