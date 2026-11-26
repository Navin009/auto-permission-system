import { dirname } from "node:path";
import { homedir } from "node:os";
import { isSafeFolderGrant, SYSTEM_FOLDERS, GrantScope, type OverrideKind } from "#core/index.ts";
import {
	NETWORK_ALLOWLIST_WHY,
	NETWORK_REMEMBER_TITLE,
	UNTRUSTED_PROJECT_NOTE,
	networkPromptFields,
	networkRememberFields,
} from "./network-prompt.ts";
import {
	askMainWithRemember,
	askRememberFile,
	askRememberHost,
	askSelect,
	formatTimeoutNote,
	ICON,
	MainChoice,
	parentDomainWildcard,
	type AskCtx,
	type PromptBody,
	type PromptField,
} from "./ask-flow.ts";
import { promptField } from "./prompt-spec.ts";

export type { AskCtx };
export type { OverrideKind };

export const Decision = {
	Yes: "yes",
	No: "no",
	TimedOut: "timed-out",
	Session: "session",
	SessionFolder: "session-folder",
	AlwaysCwd: "always-cwd",
	AlwaysGlobal: "always-global",
	AlwaysCwdFolder: "always-cwd-folder",
	AlwaysGlobalFolder: "always-global-folder",
} as const;

export type Decision = (typeof Decision)[keyof typeof Decision];

export const AskAction = {
	Read: "read",
	Write: "write",
	Network: "network",
} as const;

export type AskAction = (typeof AskAction)[keyof typeof AskAction];

export type AskKind = {
	layer: 1 | 2;
	tool: string;
	toolCallId?: string;
	subject: string;
	reason: string;
	overrideKind: OverrideKind;
	overrideValue: string;
	outside?: boolean;
	spelled?: string;
	command?: string;
	projectTrusted?: boolean;
	credentialOnly?: boolean;
};

const SYSTEM_DIRECTORIES = SYSTEM_FOLDERS;

function resolveActionFromAsk(askDetails: AskKind): AskAction {
	if (askDetails.overrideKind === "allowDomains") {
		return AskAction.Network;
	}

	if (askDetails.overrideKind === "allowWrite") {
		return AskAction.Write;
	}

	return AskAction.Read;
}

export function displayWhy(denialReason: string): string {
	const rawReason = denialReason.replace(/\s*→\s*.*$/, "").trim();

	if (rawReason.startsWith("absolute-deny matched")) {
		const matchedPattern = rawReason.match(/"([^"]+)"/)?.[1] ?? "";

		if (matchedPattern.includes("ssh")) {
			return `contains private SSH keys (${matchedPattern})`;
		}

		if (matchedPattern.includes("aws")) {
			return `contains AWS credentials (${matchedPattern})`;
		}

		if (matchedPattern.includes("gnupg")) {
			return `contains private encryption keys (${matchedPattern})`;
		}

		if (matchedPattern.includes("pem") || matchedPattern.includes("key")) {
			return `contains private security keys (${matchedPattern})`;
		}

		if (matchedPattern.includes("auth.json")) {
			return "holds login credentials";
		}

		return `contains sensitive credentials (${matchedPattern || "credentials"})`;
	}

	if (rawReason.startsWith("askRead matched")) {
		const matchedPattern = rawReason.match(/"([^"]+)"/)?.[1] ?? "";

		if (matchedPattern.includes(".env")) {
			return ".env files usually hold passwords and API keys";
		}

		return `this file usually holds private passwords or API keys (${matchedPattern})`;
	}

	if (rawReason.startsWith("denyRead matched")) {
		const matchedPattern = rawReason.match(/"([^"]+)"/)?.[1] ?? "";

		if (matchedPattern.includes(".env")) {
			return ".env files usually hold passwords and API keys";
		}

		return `protected by security rules from being read (${matchedPattern})`;
	}

	if (rawReason.startsWith("modelDenyRead matched")) {
		const matchedPattern = rawReason.match(/"([^"]+)"/)?.[1] ?? "";
		return `contains private data hidden from the AI (${matchedPattern})`;
	}

	if (rawReason.startsWith("denyWrite matched")) {
		const matchedPattern = rawReason.match(/"([^"]+)"/)?.[1] ?? "";
		return `protected file that cannot be modified (${matchedPattern})`;
	}

	if (rawReason.startsWith("askWrite matched")) {
		const matchedPattern = rawReason.match(/"([^"]+)"/)?.[1] ?? "";

		if (matchedPattern.includes("bashrc") || matchedPattern.includes("zshrc") || matchedPattern.includes("profile")) {
			return `a startup file that runs on every shell (${matchedPattern})`;
		}

		return `writing here usually means changing credentials or startup code (${matchedPattern})`;
	}

	if (rawReason.includes("not under any allowWrite root") || rawReason.includes("not under an allowWrite root")) {
		return "saving files outside your project workspace requires permission";
	}

	if (rawReason.startsWith("outside the project")) {
		return "reading files outside your project folder requires permission";
	}

	if (rawReason.startsWith("domain not in allowlist")) {
		return "this site isn't on your allowed list yet";
	}

	if (rawReason === "blocked by the sandbox filesystem policy") {
		return "restricted by your project's security policy";
	}

	return rawReason;
}

export function networkWhy(denialReason: string): string {
	if (denialReason.startsWith("domain not in allowlist")) {
		return NETWORK_ALLOWLIST_WHY;
	}

	return displayWhy(denialReason);
}

export function denyMessage(overrideKind: OverrideKind, denialReason: string): string {
	if (overrideKind === "allowDomains") {
		return `Network blocked by policy: ${networkWhy(denialReason)}. Nothing was fetched — ask the user to adjust the permission mode (/permission-mode) if needed. Do not attempt workarounds or inspect plugin files.`;
	}

	if (overrideKind === "allowWrite") {
		return `Write blocked by policy: ${displayWhy(denialReason)}. Nothing was written — ask the user to adjust the permission mode (/permission-mode) if needed. Do not attempt workarounds or inspect plugin files.`;
	}

	return `Read blocked by policy: ${displayWhy(denialReason)}. Nothing was read — ask the user to adjust the permission mode (/permission-mode) if needed. Do not attempt workarounds or inspect plugin files.`;
}

export function timeoutDenyMessage(overrideKind: OverrideKind, timeoutMs?: number): string {
	const reason = formatTimeoutNote(timeoutMs).toLowerCase();

	if (overrideKind === "allowDomains") {
		return `Network blocked by policy: ${reason}. Nothing was fetched — ask the user before retrying. Do not attempt workarounds or inspect plugin files.`;
	}

	if (overrideKind === "allowWrite") {
		return `Write blocked by policy: ${reason}. Nothing was written — ask the user before retrying. Do not attempt workarounds or inspect plugin files.`;
	}

	return `Read blocked by policy: ${reason}. Nothing was read — ask the user before retrying. Do not attempt workarounds or inspect plugin files.`;
}

export function buildFilePromptFields(options: {
	file: string;
	folder?: string | null;
	link?: string;
	command?: string;
	why?: string;
	risk?: string;
	note?: string;
}): PromptBody {
	const fields: PromptField[] = [promptField("File", options.file)];

	if (options.folder && options.folder !== options.file) {
		fields.push(promptField("Folder", `${options.folder}/`));
	}

	if (options.link && options.link !== options.file) {
		fields.push(promptField("Link", options.link));
	}

	if (options.command) {
		fields.push(promptField("Command", options.command));
	}

	if (options.why) {
		fields.push(promptField("Why", options.why));
	}

	if (options.risk) {
		fields.push(promptField("Risk", options.risk));
	}

	if (options.note) {
		fields.push(promptField("Note", options.note));
	}

	return { fields };
}

export function buildRememberFileFields(options: {
	file: string;
	folder?: string | null;
	link?: string;
	commandName: string;
	untrusted?: boolean;
}): PromptBody {
	const fields: PromptField[] = [promptField("File", options.file)];

	if (options.folder && options.folder !== options.file) {
		fields.push(promptField("Folder", `${options.folder}/`));
	}

	if (options.link && options.link !== options.file) {
		fields.push(promptField("Link", options.link));
	}

	fields.push(promptField("Note", `the rule works for any command, not just ${options.commandName}`));

	if (options.untrusted) {
		fields.push(promptField("Note", UNTRUSTED_PROJECT_NOTE));
	}

	return { fields };
}

function buildDetailBody(askDetails: AskKind, action: AskAction, noteText?: string): PromptBody {
	if (action === AskAction.Network) {
		return networkPromptFields({
			host: askDetails.overrideValue,
			wildcard: parentDomainWildcard(askDetails.overrideValue),
			command: askDetails.command,
			why: networkWhy(askDetails.reason),
			note: noteText,
		});
	}

	return buildFilePromptFields({
		file: askDetails.subject,
		folder: dirname(askDetails.subject),
		command: askDetails.command,
		why: displayWhy(askDetails.reason),
		note: noteText,
	});
}

function extractBinaryOrSubject(command: string): string {
	const words = command.trim().split(/\s+/);

	if (words[0] === "sudo" && words[1]) {
		return `${words[0]} ${words[1]}`;
	}

	return words[0] ?? command.trim();
}

function formatPromptHeader(action: AskAction, subject: string, askDetails: AskKind): string {
	if (action === AskAction.Network) {
		const commandBinary = askDetails.command ? extractBinaryOrSubject(askDetails.command) : "this command";
		return `Let ${commandBinary} connect to ${askDetails.overrideValue}?`;
	}

	const actionVerb = action === AskAction.Write ? "save files in" : "read";
	const defaultEntity = action === AskAction.Write ? "this command" : "this tool";
	const actingEntity = askDetails.command ? extractBinaryOrSubject(askDetails.command) : defaultEntity;

	return `Let ${actingEntity} ${actionVerb} ${subject}?`;
}

function isUnsafeTargetFolder(askDetails: AskKind): boolean {
	if (askDetails.overrideKind === "allowDomains") {
		return false;
	}

	const parentFolder = dirname(askDetails.overrideValue);
	const normalizedPath = parentFolder.replace(/\/$/, "");

	if (SYSTEM_DIRECTORIES.has(normalizedPath)) {
		return true;
	}

	return !isSafeFolderGrant(parentFolder, homedir());
}

function selectPromptIcon(action: AskAction, askDetails: AskKind): "net" | "warn" | "ask" {
	if (action === AskAction.Network) {
		return "net";
	}

	if (isUnsafeTargetFolder(askDetails)) {
		return "warn";
	}

	return "ask";
}

function formatCredentialFields(
	askDetails: AskKind,
	action: AskAction,
	riskDescription: string,
	noteDescription: string,
): PromptBody {
	if (action === AskAction.Network) {
		return {
			fields: [promptField("Risk", riskDescription), promptField("Note", noteDescription)],
		};
	}

	return buildFilePromptFields({
		file: askDetails.subject,
		folder: action === AskAction.Write ? dirname(askDetails.subject) : null,
		command: askDetails.command,
		risk: riskDescription,
		note: noteDescription,
	});
}

export function getCredentialLabel(subjectPath: string): string {
	if (subjectPath.endsWith(".ssh/id_rsa") || subjectPath.endsWith(".ssh/id_ed25519")) {
		return "SSH private key";
	}

	if (subjectPath.includes("/.aws/credentials")) {
		return "AWS credentials file";
	}

	if (subjectPath.includes("/.gnupg/")) {
		return "GPG key";
	}

	if (subjectPath.endsWith(".pem") || subjectPath.endsWith(".key")) {
		return "private key file";
	}

	if (subjectPath.includes("/mcp.json")) {
		return "MCP settings file";
	}

	if (subjectPath.includes("/.netrc")) {
		return "netrc file";
	}

	if (subjectPath.includes("/.npmrc")) {
		return "npmrc file";
	}

	if (subjectPath.endsWith(".env") || subjectPath.includes("/.env.")) {
		return ".env file";
	}

	return "credential file";
}

function getCredentialRisk(subjectPath: string, action: AskAction): string {
	if (subjectPath.includes("/.ssh/")) {
		return "anyone with this key can log in to your servers as you";
	}

	if (subjectPath.includes("/.aws/")) {
		return "AWS keys let you act as that IAM user";
	}

	if (subjectPath.includes("/.gnupg/")) {
		return "GPG keys let you sign or decrypt as that identity";
	}

	if (subjectPath.includes("/mcp.json")) {
		return "it holds API keys for your MCP servers";
	}

	if (subjectPath.includes("/.netrc")) {
		return "it holds plaintext credentials for git, ftp, curl";
	}

	if (subjectPath.endsWith(".pem") || subjectPath.endsWith(".key")) {
		return "this is a private key in PEM format";
	}

	return action === AskAction.Write
		? "writing here can change credential material"
		: "reading here exposes credential material";
}

async function askCredentialSelect(
	context: AskCtx,
	headerText: string,
	body: PromptBody,
	options: Array<{ value: string; label: string; key: string }>,
): Promise<{ picked: string | undefined; expired: boolean }> {
	return askSelect(context, `${ICON.cred}  ${headerText}`, options, undefined, {
		footer: "Default: No",
		fields: body.fields,
		findings: body.findings,
	});
}

export async function askDecision(
	context: AskCtx,
	askDetails: AskKind,
	absoluteDenyPattern: string | null,
): Promise<Decision> {
	if (context.hasUI === false) {
		return Decision.No;
	}

	const action = resolveActionFromAsk(askDetails);

	if (absoluteDenyPattern || askDetails.credentialOnly) {
		const subjectName = getCredentialLabel(askDetails.subject);
		const riskDescription = getCredentialRisk(askDetails.subject, action);
		const noteDescription = "can only be allowed for one read at a time";
		const promptHeader = `Let this ${action} read your ${subjectName}?`;
		const promptBody = formatCredentialFields(askDetails, action, riskDescription, noteDescription);
		const promptOptions = [
			{ value: "No   (recommended)", label: "No (recommended)", key: "n" },
			{ value: "Yes, allow this one read", label: "Yes, allow this one read", key: "y" },
		];

		const { picked, expired } = await askCredentialSelect(context, promptHeader, promptBody, promptOptions);
		if (expired) {
			return Decision.TimedOut;
		}

		return picked === promptOptions[1].value ? Decision.Yes : Decision.No;
	}

	const promptHeader = formatPromptHeader(action, askDetails.subject, askDetails);
	const sessionLabel =
		action === AskAction.Network ? "Yes, all in group for this conversation" : "Yes, for this conversation";
	const isUntrustedProject = askDetails.projectTrusted === false;
	const untrustedNote = isUntrustedProject ? 'project is untrusted — "Yes, always" saves globally only' : undefined;

	const mainDialogOptions = {
		session: true,
		sessionLabel,
		icon: selectPromptIcon(action, askDetails),
	};

	if (action === AskAction.Network) {
		const targetHostname = askDetails.overrideValue;
		const wildcardDomain = parentDomainWildcard(targetHostname);

		const { choice, grant } = await askMainWithRemember(
			context,
			promptHeader,
			buildDetailBody(askDetails, action, untrustedNote),
			mainDialogOptions,
			() => {
				const rememberBody = networkRememberFields({
					host: targetHostname,
					wildcard: wildcardDomain,
					commandName: extractBinaryOrSubject(askDetails.command ?? "this one"),
					untrusted: isUntrustedProject,
				});

				return askRememberHost(context, NETWORK_REMEMBER_TITLE, rememberBody, targetHostname, {
					icon: "save",
					untrusted: isUntrustedProject,
				});
			},
		);

		return mapNetworkOutcome(choice, grant);
	}

	const parentFolder = dirname(askDetails.subject);

	const { choice, grant } = await askMainWithRemember(
		context,
		promptHeader,
		buildDetailBody(askDetails, action, untrustedNote),
		mainDialogOptions,
		() => {
			const rememberBody = buildRememberFileFields({
				file: askDetails.subject,
				folder: parentFolder,
				commandName: extractBinaryOrSubject(askDetails.command ?? "this one"),
				untrusted: isUntrustedProject,
			});
			const actionVerb = action === AskAction.Write ? "saving" : "reading";
			const titleText = `Always allow ${actionVerb} — what, and where?`;

			return askRememberFile(context, titleText, rememberBody, askDetails.subject, parentFolder, {
				icon: "save",
				untrusted: isUntrustedProject,
			});
		},
	);

	return mapFileOutcome(choice, grant);
}

function mapNetworkOutcome(choice: MainChoice, grant: { scope: GrantScope; pattern: string } | null): Decision {
	if (choice === MainChoice.TimedOut) return Decision.TimedOut;
	if (choice === MainChoice.Block) return Decision.No;
	if (choice === MainChoice.Once) return Decision.Yes;
	if (choice === MainChoice.Session) return Decision.Session;
	if (!grant) return Decision.No;

	return grant.scope === GrantScope.Cwd ? Decision.AlwaysCwd : Decision.AlwaysGlobal;
}

function mapFileOutcome(choice: MainChoice, grant: { scope: GrantScope; folder: boolean } | null): Decision {
	if (choice === MainChoice.TimedOut) return Decision.TimedOut;
	if (choice === MainChoice.Block) return Decision.No;
	if (choice === MainChoice.Once) return Decision.Yes;
	if (choice === MainChoice.Session) return Decision.Session;
	if (!grant) return Decision.No;

	if (grant.scope === GrantScope.Cwd) {
		return grant.folder ? Decision.AlwaysCwdFolder : Decision.AlwaysCwd;
	}

	return grant.folder ? Decision.AlwaysGlobalFolder : Decision.AlwaysGlobal;
}
