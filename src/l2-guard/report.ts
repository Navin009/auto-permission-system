import { existsSync, readFileSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	bullets,
	projectPolicyPath,
	projectTrusted,
	untrustedProjectChanges,
	TRUST_STORE,
	type Policy,
} from "./policy.ts";
import { forgetProjectTrust, recordProjectDeclined, recordProjectTrust } from "#core/index.ts";
import { sessionGrantSummary } from "./prompts.ts";
import { askSelect, formatTimeoutNote } from "#ui/ask-flow.ts";
import type { AskCtx } from "#ui/ask.ts";
import { audit, AUDIT_PATH } from "#shared/audit.ts";

const TRUST_CONFIRMATION_TIMEOUT_MILLISECONDS = 120_000;
const RECENT_AUDIT_LOG_LINE_COUNT = 10;
const TIME_SLICE_START = 11;
const TIME_SLICE_END = 19;
const ALLOW_DECISIONS = new Set([
	"yes",
	"session",
	"session-grant",
	"user-named",
	"always-cwd",
	"always-global",
	"always-cwd-folder",
	"always-global-folder",
]);
const DENY_DECISIONS = new Set(["no", "denied"]);

export async function handleProjectTrustCommand(
	context: ExtensionContext,
	subcommand: "trust" | "untrust",
): Promise<void> {
	const projectPolicy = projectPolicyPath(context.cwd);

	if (!existsSync(projectPolicy)) {
		context.ui.notify("This folder has no .pi/sandbox.json.", "info");
		return;
	}

	if (subcommand === "untrust") {
		forgetProjectTrust(projectPolicy, TRUST_STORE);
		audit({ layer: 2, event: "project-untrusted", file: projectPolicy, cwd: context.cwd });
		context.ui.notify("OK. The file is not trusted now. Only its block rules apply.", "info");
		return;
	}

	if (projectTrusted(context.cwd)) {
		context.ui.notify("This file is already trusted.", "info");
		return;
	}

	const changes = untrustedProjectChanges(context.cwd);

	if (!changes.length) {
		context.ui.notify("This file only adds block rules. They apply already. You do not have to trust it.", "info");
		return;
	}

	const dialogOptions = ["No — ignore these changes (default)", "Yes — I wrote this file. Apply it."];
	const dialogTitle = `Do you trust this project's .pi/sandbox.json?\nFile     ${projectPolicy}\n\n${bullets(changes)}\n\nNote     If the file changes, auto-permission-system asks again.`;

	const { picked: selectedOption, expired } = await askSelect(
		/* SAFETY: pi's runtime ctx carries the selector; AskCtx names the member used. */
		context as unknown as AskCtx,
		dialogTitle,
		dialogOptions,
		TRUST_CONFIRMATION_TIMEOUT_MILLISECONDS,
		{
			footer: "Default: No",
			question: "Apply these project settings?",
		},
	);

	if (expired) {
		context.ui.notify(`${formatTimeoutNote(TRUST_CONFIRMATION_TIMEOUT_MILLISECONDS)}.`, "warning");
	}

	if (selectedOption !== dialogOptions[1]) {
		recordProjectDeclined(projectPolicy, TRUST_STORE);
		audit({ layer: 2, event: "project-trust-declined", file: projectPolicy, changes, cwd: context.cwd });
		context.ui.notify(
			"OK. auto-permission-system ignores these changes. It does not ask again until the file changes.",
			"info",
		);
		return;
	}

	recordProjectTrust(projectPolicy, TRUST_STORE);
	audit({ layer: 2, event: "project-trusted", file: projectPolicy, applied: changes, cwd: context.cwd });
	context.ui.notify("Done. The file applies now. Start a new conversation so the bash sandbox uses it too.", "info");
}

function determineProjectTrustStatus(
	hasProjectFile: boolean,
	isTrusted: boolean,
	untrustedChangeCount: number,
): string {
	if (!hasProjectFile) {
		return "none";
	}

	if (isTrusted) {
		return "trusted";
	}

	if (untrustedChangeCount > 0) {
		return "not trusted, its weaker settings are ignored (/security trust)";
	}

	return "only block rules, they apply";
}

export function formatSecurityGuardReport(policy: Policy, context: ExtensionContext): string {
	const projectPath = projectPolicyPath(context.cwd);
	const hasProjectFile = existsSync(projectPath);
	const isTrusted = projectTrusted(context.cwd);
	const changes = untrustedProjectChanges(context.cwd);

	const projectTrustStatus = determineProjectTrustStatus(hasProjectFile, isTrusted, changes.length);

	const outsideReads = policy.filesystem.outsideProject?.read ?? "allow";
	const outsideAllowReads = policy.filesystem.outsideProject?.allowRead ?? [];
	const outsideSummary = outsideAllowReads.length ? `, allowRead ${outsideAllowReads.join(", ")}` : "";
	const overrides = policy.overrides ?? {};

	const reportLines = [
		"Security Guard (Layer 2):",
		"",
		`  cwd:               ${context.cwd}`,
		`  hasUI:             ${(context as { hasUI?: boolean }).hasUI !== false}`,
		`  subagent.network:  ${policy.subagent?.network ?? "allow"}`,
		`  conversation grants:    ${sessionGrantSummary() || "(none)"}`,
		`  project file:      ${projectTrustStatus}`,
		`  outside project:   read ${outsideReads}${outsideSummary}`,
		"",
		"Filesystem:",
		`  denyRead:    ${policy.filesystem.denyRead.join(", ") || "(none)"}`,
		`  allowWrite:  ${policy.filesystem.allowWrite.join(", ") || "(none)"}`,
		`  denyWrite:   ${policy.filesystem.denyWrite.join(", ") || "(none)"}`,
		"",
		"Network (URL tools):",
		`  allowed:     ${formatAllowedDomains(policy.network)}`,
		`  denied:      ${policy.network.deniedDomains.join(", ") || "(none)"}`,
		"",
		"Project-local overrides (<cwd>/.pi/sandbox.json `overrides`):",
		`  allowRead:    ${(overrides.allowRead ?? []).join(", ") || "(none)"}`,
		`  allowWrite:   ${(overrides.allowWrite ?? []).join(", ") || "(none)"}`,
		`  allowDomains: ${(overrides.allowDomains ?? []).join(", ") || "(none)"}`,
	];

	if (policy.mode === "advanced-secure") {
		const mcpPolicy = policy.mcp ?? {};

		reportLines.push(
			"",
			"Advanced Secure (MCP gate, ADR-032):",
			`  allowTools:       ${(mcpPolicy.allowTools ?? []).join(", ") || "(none)"}`,
			`  allowPrefixes:    ${(mcpPolicy.allowPrefixes ?? []).join(", ") || "(none)"}`,
			`  askTools:         ${(mcpPolicy.askTools ?? []).join(", ") || "(none)"}`,
			`  trustAnnotations: ${mcpPolicy.trustAnnotations === true}`,
			`  allowSimpleUpdates: ${mcpPolicy.allowSimpleUpdates !== false}`,
			`  askThreshold:     ${mcpPolicy.askThreshold ?? 30}`,
		);
	}

	try {
		const auditTail = readFileSync(AUDIT_PATH, "utf-8").trim().split("\n").slice(-RECENT_AUDIT_LOG_LINE_COUNT);

		if (auditTail.length && auditTail[0]) {
			reportLines.push("", `Recent audit (last ${RECENT_AUDIT_LOG_LINE_COUNT}):`);

			for (const line of auditTail) {
				reportLines.push(`  ${formatAuditLine(line)}`);
			}
		}
	} catch {
		return reportLines.join("\n");
	}

	return reportLines.join("\n");
}

function formatAllowedDomains(network: Policy["network"]): string {
	if (network.allowedDomains.length > 0) {
		return network.allowedDomains.join(", ");
	}

	return network.strictAllowlist ? "(none — strict allowlist)" : "all (no allowlist)";
}

function formatAuditLine(rawLine: string): string {
	try {
		const entry = JSON.parse(rawLine) as {
			ts?: string;
			layer?: number;
			tool?: string;
			event?: string;
			subject?: string;
			file?: string;
			decision?: string;
		};
		const timestamp = typeof entry.ts === "string" ? entry.ts.slice(TIME_SLICE_START, TIME_SLICE_END) : "--------";
		const layer = entry.layer === undefined ? "L?" : `L${entry.layer}`;
		const decision = entry.decision ?? entry.event ?? "event";
		const mark = auditMark(decision);
		const action = entry.tool ?? entry.event ?? "";
		const target = entry.subject ?? entry.file ?? "";

		return [timestamp, layer, `${mark} ${decision}`, action, target].filter(Boolean).join("  ");
	} catch {
		return rawLine;
	}
}

function auditMark(decision: string): string {
	if (ALLOW_DECISIONS.has(decision)) {
		return "✓";
	}

	return DENY_DECISIONS.has(decision) ? "⊘" : "⚠";
}
