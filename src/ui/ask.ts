/**
 * Ask-tier decision mapping shared by Layer 1 (network asks from the bash
 * sandbox proxy) and Layer 2 (in-process tool guards). ADR-009, ADR-010,
 * ADR-030.
 *
 * Every prompt is a question. Answers are uniformly `No` / `Yes, just this once` /
 * `Yes, for this session` / `Yes, always…`. Body uses the canonical field set
 * File / Folder / Site / Group / Command / Why / Risk / Note. Absolute-deny
 * (credentials) collapses to ONE screen with `No` preselected. Untrusted
 * project: screen 2 hides the `in this project` rows and adds a Note.
 *
 * Pure UI→decision logic: no pi, no fs, no audit. The caller supplies a
 * `ctx.ui.select`; this module only decides which option string means what.
 * The shared two-screen UI primitives live in `./ask-flow.ts`.
 */

import { dirname } from "node:path";
import { homedir } from "node:os";
import { isSafeFolderGrant, GrantScope, type OverrideKind } from "../core/index";
import { askMain, askRememberFile, askRememberHost, parentDomainWildcard, type AskCtx } from "./ask-flow";

export type { AskCtx } from "./ask-flow";
export type { OverrideKind };

/** Erasable enum for what the user picked on screen 1 and screen 2. */
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

/** Erasable enum for which policy list an ask is about. */
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
	/** A read outside the project (ADR-012); only these may be allowed because the user named the path. */
	outside?: boolean;
	/** Absolute path as the call spelled it, before symlink resolution (/tmp vs /private/tmp). */
	spelled?: string;
	/** The bash command that triggered this ask (L1 only). Shown in the body as `Command`. */
	command?: string;
	/** True when the cwd's project sandbox.json isn't trusted (ADR-013). Screen 2 filters
	 * `in this project` rows when true. */
	projectTrusted?: boolean;
};

function actionOf(ask: AskKind): AskAction {
	if (ask.overrideKind === "allowDomains") return AskAction.Network;
	if (ask.overrideKind === "allowWrite") return AskAction.Write;
	return AskAction.Read;
}

/** The reason without the trailing `→ /abs/path` (the body already shows the path). */
export function displayWhy(reason: string): string {
	return reason.replace(/\s*→\s*.*$/, "");
}

/** A domain reason without its `: host` suffix, so it can sit next to `Site:` without repeating it. */
export function networkWhy(reason: string): string {
	return reason.startsWith("domain not in allowlist") ? "this site isn't on your allowed list yet" : displayWhy(reason);
}

/** The model-facing denial text: one pattern for every block. */
export function denyMessage(overrideKind: OverrideKind, reason: string): string {
	if (overrideKind === "allowDomains") return `Network blocked by policy: ${networkWhy(reason)}. Nothing was fetched \u2014 ask the user.`;
	if (overrideKind === "allowWrite") return `Write blocked by policy: ${displayWhy(reason)}. Nothing was written \u2014 ask the user.`;
	return `Read blocked by policy: ${displayWhy(reason)}. Nothing was read \u2014 ask the user.`;
}

/**
 * Render the canonical body fields (File / Folder / Site / Group / Command /
 * Why / Risk / Note). Aligns with two-space gaps so the body reads like a table.
 */
function detailLines(ask: AskKind, action: AskAction, note?: string): string {
	const lines: string[] = [];
	if (action === AskAction.Network) {
		const wildcard = parentDomainWildcard(ask.overrideValue);
		lines.push(`Site     ${ask.overrideValue}`);
		if (wildcard !== ask.overrideValue.toLowerCase()) {
			const bare = wildcard.replace(/^\*\./, "");
			lines.push(`Group    ${wildcard}   (every ${bare} site)`);
		}
	} else {
		const folder = dirname(ask.subject);
		lines.push(`File     ${ask.subject}`);
		if (folder !== ask.subject) lines.push(`Folder   ${folder}/`);
	}
	if (ask.command) lines.push(`Command  ${ask.command}`);
	lines.push(`Why      ${action === AskAction.Network ? networkWhy(ask.reason) : displayWhy(ask.reason)}`);
	if (note) lines.push(`Note     ${note}`);
	return lines.join("\n");
}

/**
 * The header text per action type (no icon; caller prepends the icon).
 * Titles name the binary in the bash command (`Let composio save files in X?`,
 * `Let cat read X?`) and fall back to "this command" / "this tool" when no
 * command is set.
 */
function headerFor(action: AskAction, subject: string, ask: AskKind): string {
	if (action === AskAction.Network) {
		const verb = ask.command ? firstWord(ask.command) : "this command";
		return `Let ${verb} connect to ${ask.overrideValue}?`;
	}
	const verb = action === AskAction.Write ? "save files in" : "read";
	const who = ask.command ? firstWord(ask.command) : `this ${action === AskAction.Write ? "command" : "tool"}`;
	return `Let ${who} ${verb} ${subject}?`;
}

/**
 * Whether the parent folder of the path is unsafe to grant as a whole.
 * True for /, home, parents of home, and the system roots (etc, var, usr, ...).
 * Used to pick the ⚠ icon for screen 1 of unsafe writes.
 */
function unsafeFolder(ask: AskKind): boolean {
	if (ask.overrideKind === "allowDomains") return false;
	const parent = dirname(ask.overrideValue);
	const normalized = parent.replace(/\/$/, "");
	if (SYSTEM_DIRS.has(normalized)) return true;
	return !isSafeFolderGrant(parent, homedir());
}

const SYSTEM_DIRS = new Set(["/etc", "/var", "/usr", "/bin", "/sbin", "/boot", "/lib", "/lib64", "/opt", "/srv", "/proc", "/sys", "/dev"]);

/**
 * The binary name in a bash command. Strips the `sudo` prefix and returns the
 * first one or two words so titles read naturally (`Let sudo tee save files in
 * X?`, `Let composio connect to X?`, `Let cat read X?`).
 */
function firstWord(command: string): string {
	const words = command.trim().split(/\s+/);
	if (words[0] === "sudo" && words[1]) return `${words[0]} ${words[1]}`;
	return words[0] ?? command.trim();
}

/** Pick the icon for screen 1: 🌐 for network, ⚠ for unsafe-folder writes, 🛡 for the rest. */
function pickIcon(action: AskAction, ask: AskKind): "net" | "warn" | "ask" {
	if (action === AskAction.Network) return "net";
	if (unsafeFolder(ask)) return "warn";
	return "ask";
}

/** Body for the absolute-deny credential screen (one-shot). */
function credentialBody(ask: AskKind, action: AskAction, risk: string, note: string): string {
	const lines: string[] = [];
	if (action !== AskAction.Network) {
		const folder = action === AskAction.Write ? dirname(ask.subject) : null;
		lines.push(`File     ${ask.subject}`);
		if (folder && folder !== ask.subject) lines.push(`Folder   ${folder}/`);
		if (ask.command) lines.push(`Command  ${ask.command}`);
	}
	lines.push(`Risk     ${risk}`);
	lines.push(`Note     ${note}`);
	return lines.join("\n");
}

/**
 * Single-screen credential ask. The "No" option is preselected on Enter so the
 * default action stays block; the Risk line in the body is what makes the
 * decision reversible — the user has to ↓ then Enter to approve.
 */
export async function askDecision(ctx: AskCtx, ask: AskKind, absoluteDenyPattern: string | null): Promise<Decision> {
	if (ctx.hasUI === false) return Decision.No;
	const action = actionOf(ask);

	if (absoluteDenyPattern) {
		const subject = credentialLabel(ask.subject);
		const risk = credentialRisk(ask.subject, action);
		const note = "can only be allowed for one read at a time";
		const header = `Let this ${action} read your ${subject}?`;
		const body = credentialBody(ask, action, risk, note);
		const options = ["No   (recommended)", "Yes, allow this one read"];
		const { picked } = await askSelectSafe(ctx, header, body, options, { icon: "cred" });
		return picked === options[1] ? Decision.Yes : Decision.No;
	}

	const header = headerFor(action, ask.subject, ask);
	const sessionLabel = action === AskAction.Network ? "Yes, all in group for this session" : "Yes, for this session";
	const main = await askMain(ctx, header, detailLines(ask, action), {
		session: true,
		sessionLabel,
		allowFirst: action === AskAction.Network,
		icon: pickIcon(action, ask),
	});
	if (main === "block") return Decision.No;
	if (main === "once") return Decision.Yes;
	if (main === "session") return Decision.Session;

	// Screen 2 — scope + what to allow. The wider option is preselected; the
	// caller learns the decision and the layer that persists applies the
	// actual pattern/wildcard.
	const untrusted = ask.projectTrusted === false;
	if (action === AskAction.Network) {
		const host = ask.overrideValue;
		const wildcard = parentDomainWildcard(host);
		const body: string[] = [];
		body.push(`Site     ${host}`);
		if (wildcard !== host.toLowerCase()) {
			const bare = wildcard.replace(/^\*\./, "");
			body.push(`Group    ${wildcard}   (every ${bare} site)`);
		}
		body.push(`Note     the rule works for any command, not just ${firstWord(ask.command ?? "this one")}`);
		if (untrusted) body.push(`Note     this project isn't trusted \u2014 run /security trust to save rules here`);
		const picked = await askRememberHost(ctx, "Always allow connecting \u2014 what, and where?", body.join("\n"), host, { icon: "save", untrusted });
		if (!picked) return Decision.No;
		return picked.scope === GrantScope.Cwd ? Decision.AlwaysCwd : Decision.AlwaysGlobal;
	}
	const parent = dirname(ask.subject);
	const title = `Always allow ${action === AskAction.Write ? "saving" : "reading"} \u2014 what, and where?`;
	const body: string[] = [];
	body.push(`File     ${ask.subject}`);
	if (parent !== ask.subject) body.push(`Folder   ${parent}/`);
	body.push(`Note     the rule works for any command, not just ${firstWord(ask.command ?? "this one")}`);
	if (untrusted) body.push(`Note     this project isn't trusted \u2014 run /security trust to save rules here`);
	const picked = await askRememberFile(ctx, title, body.join("\n"), ask.subject, parent, { icon: "save", untrusted });
	if (!picked) return Decision.No;
	if (picked.scope === GrantScope.Cwd) return picked.folder ? Decision.AlwaysCwdFolder : Decision.AlwaysCwd;
	return picked.folder ? Decision.AlwaysGlobalFolder : Decision.AlwaysGlobal;
}

/** Wraps askSelect with the icon prefix and footer — used by the single-screen credential flow. */
async function askSelectSafe(
	ctx: AskCtx,
	header: string,
	body: string,
	labels: string[],
	options: { icon?: "ask" | "warn" | "cred" | "net" | "save" },
): Promise<{ picked: string | undefined; expired: boolean }> {
	const { askSelect, ICON } = await import("./ask-flow");
	const icon = options.icon ? ICON[options.icon] : undefined;
	const iconPrefix = icon ? `${icon}  ` : "";
	const title = [iconPrefix + header, body].filter(Boolean).join("\n");
	return askSelect(ctx, title, labels, undefined, { footer: "Default: No" });
}

/** A short, recognizable name for a credential path so the title stays readable. */
function credentialLabel(subject: string): string {
	if (subject.endsWith(".ssh/id_rsa") || subject.endsWith(".ssh/id_ed25519")) return "SSH private key";
	if (subject.includes("/.aws/credentials")) return "AWS credentials file";
	if (subject.includes("/.gnupg/")) return "GPG key";
	if (subject.endsWith(".pem") || subject.endsWith(".key")) return "private key file";
	if (subject.includes("/mcp.json")) return "MCP settings file";
	if (subject.includes("/.netrc")) return "netrc file";
	if (subject.includes("/.npmrc")) return "npmrc file";
	if (subject.endsWith(".env") || subject.includes("/.env.")) return ".env file";
	return "credential file";
}

/** A risk sentence per credential type — used in the body of the credential prompt. */
function credentialRisk(subject: string, action: AskAction): string {
	if (subject.includes("/.ssh/")) return "anyone with this key can log in to your servers as you";
	if (subject.includes("/.aws/")) return "AWS keys let you act as that IAM user";
	if (subject.includes("/.gnupg/")) return "GPG keys let you sign or decrypt as that identity";
	if (subject.includes("/mcp.json")) return "it holds API keys for your MCP servers";
	if (subject.includes("/.netrc")) return "it holds plaintext credentials for git, ftp, curl";
	if (subject.endsWith(".pem") || subject.endsWith(".key")) return "this is a private key in PEM format";
	return action === AskAction.Write ? "writing here can change credential material" : "reading here exposes credential material";
}
