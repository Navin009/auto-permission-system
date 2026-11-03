import { basename, isAbsolute, relative } from "node:path";

const MAXIMUM_USER_MESSAGES_TO_EXAMINE = 20;
const MINIMUM_BASENAME_MATCH_LENGTH = 3;

interface SessionEntry {
	type?: string;
	message?: { role?: string; content?: unknown };
}

export interface FileTarget {
	canonical: string;
	spelled?: string;
	cwd: string;
	home: string;
}

export function extractUserMessages(
	entries: readonly unknown[],
	maximumCount = MAXIMUM_USER_MESSAGES_TO_EXAMINE,
): string[] {
	const userMessages: string[] = [];

	for (const rawEntry of entries) {
		const entry = rawEntry as SessionEntry;

		if (entry?.type !== "message" || entry.message?.role !== "user") {
			continue;
		}

		const content = entry.message.content;
		let messageText = "";

		if (typeof content === "string") {
			messageText = content;
		} else if (Array.isArray(content)) {
			messageText = content
				.filter(
					(part): part is { type: "text"; text: string } =>
						Boolean(part) &&
						(part as { type?: string }).type === "text" &&
						typeof (part as { text?: unknown }).text === "string",
				)
				.map((part) => part.text)
				.join("\n");
		}

		if (messageText.trim().length > 0) {
			userMessages.push(messageText);
		}
	}

	return userMessages.slice(-maximumCount);
}

function escapeRegularExpression(source: string): string {
	return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TOKEN_START_BOUNDARY = String.raw`(?<=^|[\s"'\`(\[<{,;=])`;
const TOKEN_END_BOUNDARY = String.raw`(?=$|[\s"'\`)\]>},;:!?]|\.(?:$|\s))`;

function containsWordToken(text: string, token: string, isCaseInsensitive: boolean): boolean {
	const regexPattern = `${TOKEN_START_BOUNDARY}${escapeRegularExpression(token)}${TOKEN_END_BOUNDARY}`;
	const regexFlags = isCaseInsensitive ? "i" : "";

	return new RegExp(regexPattern, regexFlags).test(text);
}

export function userNamedFile(
	messages: string[],
	target: FileTarget,
	isCaseInsensitive = process.platform === "darwin",
): string | null {
	const candidateForms = new Set<string>();

	const candidatePaths = [target.canonical, target.spelled];
	const absolutePaths = candidatePaths.filter(
		(candidatePath): candidatePath is string => candidatePath !== undefined && isAbsolute(candidatePath),
	);

	for (const absolutePath of absolutePaths) {
		candidateForms.add(absolutePath);

		if (absolutePath === target.home || absolutePath.startsWith(`${target.home}/`)) {
			candidateForms.add(`~${absolutePath.slice(target.home.length)}`);
		}
	}

	const relativePath = relative(target.cwd, target.canonical);

	if (relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath)) {
		if (relativePath.includes("/") || relativePath.length >= MINIMUM_BASENAME_MATCH_LENGTH) {
			candidateForms.add(relativePath);
		}

		candidateForms.add(`./${relativePath}`);

		const pathBasename = basename(target.canonical);

		if (pathBasename.length >= MINIMUM_BASENAME_MATCH_LENGTH) {
			candidateForms.add(pathBasename);
		}
	}

	for (const message of messages) {
		for (const candidateForm of candidateForms) {
			if (containsWordToken(message, candidateForm, isCaseInsensitive)) {
				return candidateForm;
			}
		}
	}

	return null;
}
