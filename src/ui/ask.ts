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
import { isSafeFolderGrant } from "../core/index";
import { askMain, askRememberFile, askRememberHost, parentDomainWildcard, type AskCtx } from "./ask-flow";

export type { AskCtx } from "./ask-flow";

export type OverrideKind = "allowRead" | "allowWrite" | "allowDomains";

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

export type Decision = "yes" | "no" | "session" | "session-folder" | "always-cwd" | "always-global" | "always-cwd-folder" | "always-global-folder";

type Action = "read" | "write" | "network";

function actionOf(k: AskKind): Action {
	if (k.overrideKind === "allowDomains") return "network";
	if (k.overrideKind === "allowWrite") return "write";
	return "read";
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

/** Render the canonical body fields (File / Folder / Site / Group / Command / Why / Risk / Note).
 * Aligns with two-space gaps so the body reads like a table. */
function detailLines(k: AskKind, action: Action, note?: string): string {
	const parts: string[] = [];
	if (action === "network") {
		const wild = parentDomainWildcard(k.overrideValue);
		parts.push(`Site     ${k.overrideValue}`);
		if (wild !== k.overrideValue.toLowerCase()) {
			const bare = wild.replace(/^\*\./, "");
			parts.push(`Group    ${wild}   (every ${bare} site)`);
		}
	} else {
		const folder = dirname(k.subject);
		parts.push(`File     ${k.subject}`);
		if (folder !== k.subject) parts.push(`Folder   ${folder}/`);
	}
	if (k.command) parts.push(`Command  ${k.command}`);
	parts.push(`Why      ${action === "network" ? networkWhy(k.reason) : displayWhy(k.reason)}`);
	if (note) parts.push(`Note     ${note}`);
	return parts.join("\n");
}

/** The header text per action type (no icon; caller prepends the icon).
 *  Titles name the binary in the bash command (`Let composio save files in X?`,
 *  `Let cat read X?`) and fall back to "this command" / "this tool" when no command is set. */
function headerFor(action: Action, subject: string, k: AskKind): string {
	if (action === "network") {
		const verb = k.command ? firstWord(k.command) : "this command";
		// k.overrideValue is the bare host (no port); k.subject may include ":443".
		return `Let ${verb} connect to ${k.overrideValue}?`;
	}
	const verb = action === "write" ? "save files in" : "read";
	const who = k.command ? firstWord(k.command) : `this ${action === "write" ? "command" : "tool"}`;
	return `Let ${who} ${verb} ${subject}?`;
}



/** Whether the parent folder of the path is unsafe to grant as a whole.
 *  True for /, home, parents of home, and the system roots (etc, var, usr, ...).
 *  Used to pick the ⚠ icon for screen 1 of unsafe writes. */
function unsafeFolder(k: AskKind): boolean {
	if (k.overrideKind === "allowDomains") return false;
	const parent = dirname(k.overrideValue);
	const norm = parent.replace(/\/$/, "");
	if (SYSTEM_DIRS.has(norm)) return true;
	return !isSafeFolderGrant(parent, homedir());
}

const SYSTEM_DIRS = new Set(["/etc", "/var", "/usr", "/bin", "/sbin", "/boot", "/lib", "/lib64", "/opt", "/srv", "/proc", "/sys", "/dev"]);

/** The binary name in a bash command. Strips the `sudo` prefix and returns the first
 *  one or two words so titles read naturally (`Let sudo tee save files in X?`,
 *  `Let composio connect to X?`, `Let cat read X?`). */
function firstWord(s: string): string {
	const parts = s.trim().split(/\s+/);
	if (parts[0] === "sudo" && parts[1]) return `${parts[0]} ${parts[1]}`;
	return parts[0] ?? s.trim();
}

/** Pick the icon for screen 1: 🌐 for network, ⚠ for unsafe-folder writes, 🛡 for the rest. */
function pickIcon(action: Action, k: AskKind): "net" | "warn" | "ask" {
	if (action === "network") return "net";
	if (unsafeFolder(k)) return "warn";
	return "ask";
}

/** Body for the absolute-deny credential screen (one-shot). */
function credentialBody(k: AskKind, action: Action, risk: string, note: string): string {
	const parts: string[] = [];
	if (action !== "network") {
		const folder = action === "write" ? dirname(k.subject) : null;
		parts.push(`File     ${k.subject}`);
		if (folder && folder !== k.subject) parts.push(`Folder   ${folder}/`);
		if (k.command) parts.push(`Command  ${k.command}`);
	}
	parts.push(`Risk     ${risk}`);
	parts.push(`Note     ${note}`);
	return parts.join("\n");
}

/** Single-screen credential ask. The "No" option is preselected on Enter so the default
 * action stays block; the Risk line in the body is what makes the decision reversible —
 * the user has to ↓ then Enter to approve. */
export async function askDecision(ctx: AskCtx, k: AskKind, absoluteDenyPattern: string | null): Promise<Decision> {
	if (ctx.hasUI === false) return "no"; // subagents, -p, JSON mode
	const action = actionOf(k);

	if (absoluteDenyPattern) {
		const subject = credentialLabel(k.subject);
		const risk = credentialRisk(k.subject, action);
		const note = "can only be allowed for one read at a time";
		const header = `Let this ${action} read your ${subject}?`;
		const body = credentialBody(k, action, risk, note);
		const options = ["No   (recommended)", "Yes, allow this one read"];
		const { picked } = await askSelectSafe(ctx, header, body, options, { icon: "cred" });
		return picked === options[1] ? "yes" : "no";
	}

	// Screen 1 — verdict + duration.
	const header = headerFor(action, k.subject, k);
	const sessionLabel = action === "network"
		? "Yes, all in group for this session"
		: "Yes, for this session";
	const main = await askMain(ctx, header, detailLines(k, action), {
		session: true,
		sessionLabel,
		allowFirst: action === "network",
		icon: pickIcon(action, k),
	});
	if (main === "block") return "no";
	if (main === "once") return "yes";
	if (main === "session") return "session";

	// Screen 2 — scope + what to allow. The wider option is preselected; the
	// caller just learns the decision and the actual pattern/wildcard is applied
	// by the layer that performs the persistence.
	const untrusted = k.projectTrusted === false;
	if (action === "network") {
		const host = k.overrideValue;
		const wild = parentDomainWildcard(host);
		const title = "Always allow connecting \u2014 what, and where?";
		const body: string[] = [];
		body.push(`Site     ${host}`);
		if (wild !== host.toLowerCase()) {
			const bare = wild.replace(/^\*\./, "");
			body.push(`Group    ${wild}   (every ${bare} site)`);
		}
		body.push(`Note     the rule works for any command, not just ${firstWord(k.command ?? "this one")}`);
		if (untrusted) body.push(`Note     this project isn't trusted \u2014 run /security trust to save rules here`);
		const picked = await askRememberHost(ctx, title, body.join("\n"), host, { icon: "save", untrusted });
		if (!picked) return "no";
		return picked.scope === "cwd" ? "always-cwd" : "always-global";
	}
	const parent = dirname(k.subject);
	const title = `Always allow ${action === "write" ? "saving" : "reading"} \u2014 what, and where?`;
	const body: string[] = [];
	body.push(`File     ${k.subject}`);
	if (parent !== k.subject) body.push(`Folder   ${parent}/`);
	body.push(`Note     the rule works for any command, not just ${firstWord(k.command ?? "this one")}`);
	if (untrusted) body.push(`Note     this project isn't trusted \u2014 run /security trust to save rules here`);
	const picked = await askRememberFile(ctx, title, body.join("\n"), k.subject, parent, { icon: "save", untrusted });
	if (!picked) return "no";
	if (picked.scope === "cwd") return picked.folder ? "always-cwd-folder" : "always-cwd";
	return picked.folder ? "always-global-folder" : "always-global";
}

/** Wraps askSelect with the icon prefix and footer — used by the single-screen credential flow. */
async function askSelectSafe(ctx: AskCtx, header: string, body: string, options: string[], opts: { icon?: "ask" | "warn" | "cred" | "net" | "save" }) {
	const { askSelect, ICON } = await import("./ask-flow");
	const icon = opts.icon ? ICON[opts.icon] : undefined;
	const iconPrefix = icon ? `${icon}  ` : "";
	const title = [iconPrefix + header, body, "Esc or no answer in 10s = No"].filter(Boolean).join("\n");
	return askSelect(ctx, title, options);
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
function credentialRisk(subject: string, action: Action): string {
	if (subject.includes("/.ssh/")) return "anyone with this key can log in to your servers as you";
	if (subject.includes("/.aws/")) return "AWS keys let you act as that IAM user";
	if (subject.includes("/.gnupg/")) return "GPG keys let you sign or decrypt as that identity";
	if (subject.includes("/mcp.json")) return "it holds API keys for your MCP servers";
	if (subject.includes("/.netrc")) return "it holds plaintext credentials for git, ftp, curl";
	if (subject.endsWith(".pem") || subject.endsWith(".key")) return "this is a private key in PEM format";
	return action === "write" ? "writing here can change credential material" : "reading here exposes credential material";
}