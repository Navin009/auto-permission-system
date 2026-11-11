import { dirname } from "node:path";
import { homedir } from "node:os";
import { isSafeFolderGrant, SYSTEM_FOLDERS, GrantScope, type OverrideKind } from "../core/index.ts";
import {
	askMainWithRemember,
	askRememberFile,
	askRememberHost,
	MainChoice,
	parentDomainWildcard,
	type AskCtx,
} from "./ask-flow.ts";

export type { AskCtx };
export type { OverrideKind };

export const Decision = {
	Yes: "yes",
	No: "no",
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
		return "this site isn't on your allowed list yet";
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

function buildDetailLines(askDetails: AskKind, action: AskAction, noteText?: string): string {
	const detailLines: string[] = [];

	if (action === AskAction.Network) {
		const wildcardDomain = parentDomainWildcard(askDetails.overrideValue);
		detailLines.push(`Site     ${askDetails.overrideValue}`);

		if (wildcardDomain !== askDetails.overrideValue.toLowerCase()) {
			const rootDomain = wildcardDomain.replace(/^\*\./, "");
			detailLines.push(`Group    ${wildcardDomain}   (every ${rootDomain} site)`);
		}
	} else {
		const parentFolder = dirname(askDetails.subject);
		detailLines.push(`File     ${askDetails.subject}`);

		if (parentFolder !== askDetails.subject) {
			detailLines.push(`Folder   ${parentFolder}/`);
		}
	}

	if (askDetails.command) {
		detailLines.push(`Command  ${askDetails.command}`);
	}

	const reasonExplanation = action === AskAction.Network ? networkWhy(askDetails.reason) : displayWhy(askDetails.reason);
	detailLines.push(`Why      ${reasonExplanation}`);

	if (noteText) {
		detailLines.push(`Note     ${noteText}`);
	}

	return detailLines.join("\n");
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

function formatCredentialBody(askDetails: AskKind, action: AskAction, riskDescription: string, noteDescription: string): string {
	const bodyLines: string[] = [];

	if (action !== AskAction.Network) {
		const parentFolder = action === AskAction.Write ? dirname(askDetails.subject) : null;
		bodyLines.push(`File     ${askDetails.subject}`);

		if (parentFolder && parentFolder !== askDetails.subject) {
			bodyLines.push(`Folder   ${parentFolder}/`);
		}

		if (askDetails.command) {
			bodyLines.push(`Command  ${askDetails.command}`);
		}
	}

	bodyLines.push(`Risk     ${riskDescription}`);
	bodyLines.push(`Note     ${noteDescription}`);

	return bodyLines.join("\n");
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

async function askSelectSafe(
	context: AskCtx,
	headerText: string,
	bodyText: string,
	choiceLabels: string[],
	options: { icon?: "ask" | "warn" | "cred" | "net" | "save" },
): Promise<{ picked: string | undefined; expired: boolean }> {
	const { askSelect, ICON } = await import("./ask-flow.ts");
	const iconSymbol = options.icon ? ICON[options.icon] : undefined;
	const iconPrefix = iconSymbol ? `${iconSymbol}  ` : "";
	const combinedTitle = [iconPrefix + headerText, bodyText].filter(Boolean).join("\n");

	return askSelect(context, combinedTitle, choiceLabels, undefined, { footer: "Default: No" });
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
		const promptBody = formatCredentialBody(askDetails, action, riskDescription, noteDescription);
		const promptOptions = ["No   (recommended)", "Yes, allow this one read"];

		const { picked } = await askSelectSafe(context, promptHeader, promptBody, promptOptions, { icon: "cred" });
		return picked === promptOptions[1] ? Decision.Yes : Decision.No;
	}

	const promptHeader = formatPromptHeader(action, askDetails.subject, askDetails);
	const sessionLabel = action === AskAction.Network ? "Yes, all in group for this conversation" : "Yes, for this conversation";
	const isUntrustedProject = askDetails.projectTrusted === false;

	const mainDialogOptions = {
		session: true,
		sessionLabel,
		allowFirst: action === AskAction.Network,
		icon: selectPromptIcon(action, askDetails),
	};

	if (action === AskAction.Network) {
		const targetHostname = askDetails.overrideValue;
		const wildcardDomain = parentDomainWildcard(targetHostname);

		const { choice, grant } = await askMainWithRemember(
			context,
			promptHeader,
			buildDetailLines(askDetails, action),
			mainDialogOptions,
			() => {
				const rememberLines: string[] = [];
				rememberLines.push(`Site     ${targetHostname}`);

				if (wildcardDomain !== targetHostname.toLowerCase()) {
					const rootDomain = wildcardDomain.replace(/^\*\./, "");
					rememberLines.push(`Group    ${wildcardDomain}   (every ${rootDomain} site)`);
				}

				const commandName = extractBinaryOrSubject(askDetails.command ?? "this one");
				rememberLines.push(`Note     the rule works for any command, not just ${commandName}`);

				if (isUntrustedProject) {
					rememberLines.push("Note     this project isn't trusted — run /security trust to save rules here");
				}

				return askRememberHost(
					context,
					"Always allow connecting — what, and where?",
					rememberLines.join("\n"),
					targetHostname,
					{ icon: "save", untrusted: isUntrustedProject },
				);
			},
		);

		if (choice === MainChoice.Block) {
			return Decision.No;
		}

		if (choice === MainChoice.Once) {
			return Decision.Yes;
		}

		if (choice === MainChoice.Session) {
			return Decision.Session;
		}

		if (!grant) {
			return Decision.No;
		}

		return grant.scope === GrantScope.Cwd ? Decision.AlwaysCwd : Decision.AlwaysGlobal;
	}

	const parentFolder = dirname(askDetails.subject);

	const { choice, grant } = await askMainWithRemember(
		context,
		promptHeader,
		buildDetailLines(askDetails, action),
		mainDialogOptions,
		() => {
			const rememberLines: string[] = [];
			rememberLines.push(`File     ${askDetails.subject}`);

			if (parentFolder !== askDetails.subject) {
				rememberLines.push(`Folder   ${parentFolder}/`);
			}

			const commandName = extractBinaryOrSubject(askDetails.command ?? "this one");
			rememberLines.push(`Note     the rule works for any command, not just ${commandName}`);

			if (isUntrustedProject) {
				rememberLines.push("Note     this project isn't trusted — run /security trust to save rules here");
			}

			const actionVerb = action === AskAction.Write ? "saving" : "reading";
			const titleText = `Always allow ${actionVerb} — what, and where?`;

			return askRememberFile(
				context,
				titleText,
				rememberLines.join("\n"),
				askDetails.subject,
				parentFolder,
				{ icon: "save", untrusted: isUntrustedProject },
			);
		},
	);

	if (choice === MainChoice.Block) {
		return Decision.No;
	}

	if (choice === MainChoice.Once) {
		return Decision.Yes;
	}

	if (choice === MainChoice.Session) {
		return Decision.Session;
	}

	if (!grant) {
		return Decision.No;
	}

	if (grant.scope === GrantScope.Cwd) {
		return grant.folder ? Decision.AlwaysCwdFolder : Decision.AlwaysCwd;
	}

	return grant.folder ? Decision.AlwaysGlobalFolder : Decision.AlwaysGlobal;
}
