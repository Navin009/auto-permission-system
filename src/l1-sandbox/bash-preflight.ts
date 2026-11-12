import { homedir } from "node:os";
import { basename, dirname } from "node:path";
import {
	askReadFindings,
	askWriteCandidates,
	deniedWriteCandidates,
	isSafeFolderGrant,
	isSessionFolderGrant,
	matchedAskCommands,
	outsideProjectMode,
	outsideProjectReadCandidates,
	ReadExposure,
	type AskReadFinding,
} from "../core/index.ts";
import { audit } from "../shared/audit.ts";
import { canonicalize } from "../shared/canonicalize.ts";
import { askMain, askMainWithRemember, askRememberFile, MainChoice, type AskCtx } from "../ui/ask-flow.ts";
import { displayWhy, getCredentialLabel } from "../ui/ask.ts";
import { loadConfig, projectTrusted } from "./config.ts";

const CREDENTIAL_NOTE = "this file holds secrets, so a saved rule is never offered";

export interface SandboxedBashOptions {
	ctx?: {
		cwd: string;
		hasUI?: boolean;
		ui?: {
			select?: (title: string, options: string[], opts?: { timeout?: number }) => Promise<string | undefined>;
			notify?: (message: string, level?: string) => void;
		};
	};
	onAlways?: (absolutePath: string, scope: "cwd" | "global") => Promise<string>;
	onAlwaysRead?: (absolutePath: string, scope: "cwd" | "global") => Promise<string>;
}

export type SandboxedBashOpts = SandboxedBashOptions;

export function extractBinaryName(command: string): string {
	return command.trim().split(/\s+/)[0] ?? command;
}

export function formatBlockedLine(action: "Read" | "Write", reason: string, outcome: "read" | "written" | "run"): string {
	return `[Security Policy Notice] ${action} blocked by policy: ${reason}. Nothing was ${outcome}. Inform the user; do not attempt workarounds.`;
}

export const auditLayer1Bash = (entry: Record<string, unknown>) =>
	audit({ layer: 1, tool: "bash", ...entry });

const deduplicatePaths = (paths: readonly string[]): string[] => [...new Set(paths)];

const sessionGrantCovers = (grants: readonly string[], absolutePath: string): boolean =>
	grants.some((grant) => absolutePath === grant || absolutePath.startsWith(`${grant}/`));

const isInsideProject = (absolutePath: string, workingDirectory: string): boolean =>
	absolutePath === workingDirectory || absolutePath.startsWith(`${workingDirectory}/`);

const recordSessionGrant = (grants: string[], absolutePath: string): void => {
	const parentDirectory = dirname(absolutePath);

	grants.push(isSessionFolderGrant(parentDirectory, homedir()) ? parentDirectory : absolutePath);
};

type AutomatedBlockAction = "command" | "read" | "write";

function blockAutomated(
	action: AutomatedBlockAction,
	subject: string,
	onData: (chunk: Buffer) => void,
): { exitCode: number } {
	const blockedSubject =
		action === "command"
			? `command execution was blocked (automated environment): ${subject}`
			: `${action} access to ${subject} was blocked (automated environment)`;

	onData(Buffer.from(`\n[Security Block] sandbox: ${blockedSubject}. Command was not executed.\n`));

	return { exitCode: 1 };
}

async function confirmWritePath(askContext: AskCtx, absolutePath: string): Promise<string | undefined> {
	const promptLines = [
		`File     ${absolutePath}`,
		`Why      this file usually holds passwords and API keys`,
		`Risk     the AI can change what the app reads, or wipe a key`,
		`Note     ${CREDENTIAL_NOTE}`,
	];

	return askMain(askContext, `Let this command write ${basename(absolutePath)}?`, promptLines.join("\n"), {
		session: true,
		remember: false,
		icon: "cred",
	});
}

function describeAskRead(finding: AskReadFinding, command: string): { title: string; body: string } {
	const credentialLabel = getCredentialLabel(finding.path);
	const isNameOnly = finding.exposure === ReadExposure.Name;

	const title = isNameOnly
		? `Let this command list your ${credentialLabel} by name?`
		: `Let this command read your ${credentialLabel}?`;

	const riskLine = isNameOnly
		? "only the file name \u2014 this command never opens the file"
		: "the AI will see any keys in it";

	const bodyLines = [
		`File     ${finding.path}`,
		`Command  ${command.trim()}`,
		`Risk     ${riskLine}`,
		`Why      ${displayWhy(`askRead matched "${finding.pattern}"`)}`,
		`Note     ${CREDENTIAL_NOTE}`,
	];

	return { title, body: bodyLines.join("\n") };
}

export const sessionReadGrants: string[] = [];
export const sessionWriteGrants: string[] = [];
export const sessionAskReadGrants: string[] = [];
export const sessionAskWriteGrants: string[] = [];

export function clearFilesystemSessionGrants(): void {
	sessionReadGrants.length = 0;
	sessionWriteGrants.length = 0;
	sessionAskReadGrants.length = 0;
	sessionAskWriteGrants.length = 0;
}

export function filesystemSessionGrantSummary(): string {
	const writes = sessionWriteGrants.map((entryPath) => `write:${entryPath}`);
	const reads = sessionReadGrants.map((entryPath) => `read:${entryPath}`);
	const askReads = sessionAskReadGrants.map((entryPath) => `askRead:${entryPath}`);
	const askWrites = sessionAskWriteGrants.map((entryPath) => `askWrite:${entryPath}`);

	return [...writes, ...reads, ...askReads, ...askWrites].join(", ");
}

export async function preflightSensitiveCommands(
	command: string,
	workingDirectory: string,
	options: SandboxedBashOptions | undefined,
	onData: (chunk: Buffer) => void,
): Promise<{ exitCode: number } | undefined> {
	const sensitiveCommandPatterns = loadConfig(workingDirectory).commands?.ask ?? [];

	if (!sensitiveCommandPatterns.length) {
		return undefined;
	}

	const matchedCommands = matchedAskCommands(command, sensitiveCommandPatterns, workingDirectory, homedir());

	if (!matchedCommands.length) {
		return undefined;
	}

	if (!options?.ctx?.hasUI || !options.ctx.ui?.select) {
		auditLayer1Bash({ subject: matchedCommands.join(", "), decision: "no", note: "sensitive-command-headless", cwd: workingDirectory });

		return blockAutomated("command", matchedCommands.join(", "), onData);
	}

	const askContext = options.ctx as AskCtx;

	const bodyLines: string[] = [
		`Command  ${matchedCommands.join(", ")}`,
		`Risk     environment variables often hold API keys and tokens`,
		`Note     can only be allowed one run at a time`,
	];

	if (command.includes("\n")) {
		bodyLines.push(`\nScript:\n${command}`);
	}

	const promptBody = bodyLines.join("\n");
	const userChoice = await askMain(
		askContext,
		`Let ${matchedCommands[0]} print your environment variables?`,
		promptBody,
		{ once: true, remember: false, icon: "cred" },
	);

	const targetSubject = matchedCommands.join(", ");

	if (userChoice === "once") {
		auditLayer1Bash({ subject: targetSubject, decision: "once", note: "sensitive-command", cwd: workingDirectory });
		return undefined;
	}

	auditLayer1Bash({ subject: targetSubject, decision: "no", note: "sensitive-command", cwd: workingDirectory });
	onData(
		Buffer.from(
			`\n[Security Block] sandbox: command execution was denied by user: ${targetSubject}. Command was not executed.\n`,
		),
	);

	return { exitCode: 1 };
}

export async function preflightWriteAccess(
	command: string,
	workingDirectory: string,
	options: SandboxedBashOptions | undefined,
	onData: (chunk: Buffer) => void,
): Promise<{ exitCode: number } | undefined> {
	const filesystemPolicy = loadConfig(workingDirectory).filesystem;

	if (!filesystemPolicy) {
		return undefined;
	}

	const resolvePath = (path: string) => canonicalize(path, workingDirectory);
	const deniedPaths = deduplicatePaths(
		deniedWriteCandidates(command, workingDirectory, homedir(), filesystemPolicy, resolvePath),
	);

	if (deniedPaths.length) {
		auditLayer1Bash({ subject: deniedPaths.join(", "), decision: "no", note: "deny-write", cwd: workingDirectory });
		onData(
			Buffer.from(`\n${formatBlockedLine("Write", `denyWrite matched ${deniedPaths.join(", ")}`, "written")}\n`),
		);

		return { exitCode: 1 };
	}

	const askPaths = deduplicatePaths(
		askWriteCandidates(command, workingDirectory, homedir(), filesystemPolicy, resolvePath),
	);

	for (const absolutePath of askPaths) {
		if (sessionGrantCovers(sessionAskWriteGrants, absolutePath)) {
			continue;
		}

		const askContext = options?.ctx as AskCtx | undefined;

		if (!askContext?.hasUI || !askContext.ui?.select) {
			auditLayer1Bash({ subject: absolutePath, decision: "no", note: "ask-write-headless", cwd: workingDirectory });

			return blockAutomated("write", absolutePath, onData);
		}

		const userChoice = await confirmWritePath(askContext, absolutePath);

		if (userChoice === "once" || userChoice === "session") {
			if (userChoice === "session") {
				recordSessionGrant(sessionAskWriteGrants, absolutePath);
			}

			auditLayer1Bash({ subject: absolutePath, decision: userChoice, note: "ask-write", cwd: workingDirectory });
			continue;
		}

		auditLayer1Bash({ subject: absolutePath, decision: "no", note: "ask-write", cwd: workingDirectory });
		onData(Buffer.from(`\n${formatBlockedLine("Write", `write access to ${absolutePath} was denied by user`, "written")}\n`));

		return { exitCode: 1 };
	}

	return undefined;
}

export async function preflightAskReads(
	command: string,
	workingDirectory: string,
	options: SandboxedBashOptions | undefined,
	onData: (chunk: Buffer) => void,
): Promise<{ exitCode: number } | undefined> {
	const filesystemPolicy = loadConfig(workingDirectory).filesystem;

	if (!filesystemPolicy?.askRead?.length) {
		return undefined;
	}

	const findings = askReadFindings(
		command,
		workingDirectory,
		homedir(),
		filesystemPolicy,
		undefined,
		(path) => canonicalize(path, workingDirectory),
	);

	if (!findings.length) {
		return undefined;
	}

	const askContext = options?.ctx as AskCtx | undefined;

	for (const finding of findings) {
		if (finding.exposure === ReadExposure.Name && isInsideProject(finding.path, workingDirectory)) {
			auditLayer1Bash({ subject: finding.path, decision: "allow", note: "ask-read-name-only", cwd: workingDirectory });
			continue;
		}

		if (sessionGrantCovers(sessionAskReadGrants, finding.path)) {
			continue;
		}

		if (!askContext?.hasUI || !askContext.ui?.select) {
			auditLayer1Bash({ subject: finding.path, decision: "no", note: "ask-read-headless", cwd: workingDirectory });

			return blockAutomated("read", finding.path, onData);
		}

		const prompt = describeAskRead(finding, command);

		const userChoice = await askMain(askContext, prompt.title, prompt.body, {
			session: true,
			remember: false,
			icon: "cred",
		});

		if (userChoice === "once" || userChoice === "session") {
			if (userChoice === "session") {
				recordSessionGrant(sessionAskReadGrants, finding.path);
			}

			auditLayer1Bash({ subject: finding.path, decision: userChoice, note: "ask-read", cwd: workingDirectory });
			continue;
		}

		auditLayer1Bash({ subject: finding.path, decision: "no", note: "ask-read", cwd: workingDirectory });
		onData(
			Buffer.from(`\n[Security Block] sandbox: read access to ${finding.path} was denied by user. Command was not executed.\n`),
		);

		return { exitCode: 1 };
	}

	return undefined;
}

export async function preflightOutsideReads(
	command: string,
	workingDirectory: string,
	options: SandboxedBashOptions | undefined,
	onData: (chunk: Buffer) => void,
): Promise<{ blocked: { exitCode: number } } | { once: string[] } | undefined> {
	const filesystemPolicy = loadConfig(workingDirectory).filesystem;

	if (
		!filesystemPolicy ||
		outsideProjectMode(filesystemPolicy) !== "ask" ||
		!options?.ctx?.hasUI ||
		!options.ctx.ui?.select ||
		!options.onAlwaysRead
	) {
		return undefined;
	}

	const allowedOncePaths: string[] = [];

	const candidatePaths = outsideProjectReadCandidates(
		command,
		workingDirectory,
		homedir(),
		filesystemPolicy,
		undefined,
		(path) => canonicalize(path, workingDirectory),
	);

	const uniqueCandidatePaths = deduplicatePaths(candidatePaths.map((path) => canonicalize(path, workingDirectory)));

	for (const absolutePath of uniqueCandidatePaths) {
		if (sessionReadGrants.includes(absolutePath)) {
			continue;
		}

		const askContext = options.ctx as AskCtx;
		const parentDirectory = dirname(absolutePath);
		const folderGrant = isSafeFolderGrant(parentDirectory, homedir()) ? parentDirectory : null;

		const mainPromptLines = [
			`File     ${absolutePath}`,
			`Command  ${command}`,
			`Why      files outside your project need your OK`,
		];

		const rememberPromptLines = [
			`File     ${absolutePath}`,
			`Folder   ${parentDirectory}/`,
			`Note     the rule works for any command, not just ${extractBinaryName(command)}`,
		];

		const { choice, grant } = await askMainWithRemember(
			askContext,
			"Let this command read a file outside your project?",
			mainPromptLines.join("\n"),
			{ session: true },
			() =>
				askRememberFile(
					askContext,
					"Always allow reading — what, and where?",
					rememberPromptLines.join("\n"),
					absolutePath,
					folderGrant,
					{ icon: "save", untrusted: !projectTrusted(workingDirectory) },
				),
		);

		if (choice === MainChoice.Once) {
			auditLayer1Bash({ subject: absolutePath, decision: "once", reason: "outside-project-read", note: "preflight", cwd: workingDirectory });
			allowedOncePaths.push(absolutePath);
			continue;
		}

		if (choice === MainChoice.Session) {
			sessionReadGrants.push(absolutePath);
			auditLayer1Bash({ subject: absolutePath, decision: "session", scope: "session", reason: "outside-project-read", note: "preflight", cwd: workingDirectory });
			options.ctx.ui?.notify?.(`sandbox: allowed read of ${absolutePath} for this conversation (not saved)`, "info");
			continue;
		}

		if (choice !== MainChoice.Remember || !grant) {
			auditLayer1Bash({ subject: absolutePath, decision: "no", reason: "outside-project-read", note: "preflight", cwd: workingDirectory });
			onData(Buffer.from(`\n${formatBlockedLine("Read", "outside the project", "run")}\n`));
			return { blocked: { exitCode: 1 } };
		}

		const targetSubject = grant.folder ? parentDirectory : absolutePath;
		const targetScope = grant.scope;

		try {
			const persistedPath = await options.onAlwaysRead(targetSubject, targetScope);
			auditLayer1Bash({ subject: targetSubject, decision: targetScope === "cwd" ? "always-cwd" : "always-global", scope: targetScope, cwd: workingDirectory, persisted_to: persistedPath, note: "preflight" });
			options.ctx.ui?.notify?.(`sandbox: allowed read of ${targetSubject} (${targetScope})`, "warning");
		} catch (error) {
			auditLayer1Bash({ subject: targetSubject, scope: targetScope, cwd: workingDirectory, error: String(error), note: "preflight" });
			onData(Buffer.from(`\n❌ sandbox: could not save the permission (${error}). ${targetSubject} remains blocked.\n`));
			return { blocked: { exitCode: 1 } };
		}
	}

	return { once: allowedOncePaths };
}
