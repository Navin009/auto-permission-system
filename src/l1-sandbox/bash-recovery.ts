import { homedir } from "node:os";
import { dirname } from "node:path";
import {
	attributeLoopbackFailure,
	commandMentionsPath,
	extractBlockedPath,
	isBlockedAccessError,
	isSafeFolderGrant,
	isWriteBlockError,
	matchesPolicyPattern,
	outsideProjectMode,
	outsideProjectReadDenied,
} from "#core/index.ts";
import { canonicalize } from "#shared/canonicalize.ts";
import { rememberNativeNote } from "#shared/gate-notes.ts";
import {
	askMainWithRemember,
	askRememberFile,
	formatTimeoutNote,
	MainChoice,
	notifyPromptTimeout,
	type AskCtx,
} from "#ui/ask-flow.ts";
import { buildFilePromptFields, buildRememberFileFields } from "#ui/ask.ts";
import { loadConfig, projectTrusted } from "./config.ts";
import {
	auditLayer1Bash,
	extractBinaryName,
	formatBlockedLine,
	sessionReadGrants,
	sessionWriteGrants,
	type SandboxedBashOptions,
} from "./bash-preflight.ts";
import { POLICY_NOTICE } from "#shared/messages.ts";

function notifyRecoveryNote(options: SandboxedBashOptions | undefined, note: string, notifyFallback: string): void {
	if (options?.toolCallId) {
		rememberNativeNote(options.toolCallId, note);
		return;
	}

	options?.ctx?.ui?.notify?.(notifyFallback, "info");
}

export interface BlockedBashExecutionContext {
	exitCode: number | null;
	outputTail: string;
	command: string;
	workingDirectory: string;
	allowLocalhost: boolean;
	bridgedPorts: number[];
	options: SandboxedBashOptions | undefined;
	writeOnce: string[];
	readOnce: string[];
	grantedWriteFolders: Set<string>;
	grantedWriteFiles: Set<string>;
	onData: (chunk: Buffer) => void;
	retryExecution: (additionalWriteGrants: string[]) => Promise<{ exitCode: number | null }>;
}

export async function handleBlockedBashExecution(
	execution: BlockedBashExecutionContext,
): Promise<{ wasHandled: boolean; retryPromise?: Promise<{ exitCode: number | null }> }> {
	const {
		exitCode,
		outputTail,
		command,
		workingDirectory,
		allowLocalhost,
		bridgedPorts,
		options,
		writeOnce,
		readOnce,
		grantedWriteFolders,
		grantedWriteFiles,
		onData,
		retryExecution,
	} = execution;

	let offendingPath: string | undefined;
	let spelledOffendingPath: string | undefined;
	let isReadDenied = false;
	let isWriteDenied = false;
	let isHardDenied = false;
	let hardDenialReason = "";
	let isOutsideDenied = false;
	let outsideReadMode: "allow" | "ask" | "deny" = "allow";
	let blockedNotice = "";
	let isSandboxSetupError = false;

	if (exitCode !== 0 && isBlockedAccessError(outputTail)) {
		isSandboxSetupError = /(^|\n)\s*bwrap:/i.test(outputTail);
		spelledOffendingPath = extractBlockedPath(outputTail, workingDirectory, homedir());
		offendingPath = spelledOffendingPath ? canonicalize(spelledOffendingPath, workingDirectory) : undefined;
		isWriteDenied = isWriteBlockError(outputTail);

		if (offendingPath) {
			const filesystemConfig = loadConfig(workingDirectory).filesystem;

			if (filesystemConfig) {
				const denyReadPattern = filesystemConfig.denyRead.find((pattern) =>
					matchesPolicyPattern(offendingPath as string, pattern, workingDirectory, homedir()),
				);

				const denyWritePattern = isWriteDenied
					? filesystemConfig.denyWrite.find((pattern) =>
							matchesPolicyPattern(offendingPath as string, pattern, workingDirectory, homedir()),
						)
					: undefined;

				isHardDenied = denyReadPattern !== undefined || denyWritePattern !== undefined;
				let hardReason = "";

				if (denyReadPattern) {
					hardReason = `denyRead matched "${denyReadPattern}"`;
				} else if (denyWritePattern) {
					hardReason = `denyWrite matched "${denyWritePattern}"`;
				}

				hardDenialReason = hardReason;

				isOutsideDenied =
					!isWriteDenied && outsideProjectReadDenied(offendingPath, workingDirectory, homedir(), filesystemConfig);
				outsideReadMode = outsideProjectMode(filesystemConfig);
			}

			isReadDenied = isHardDenied || isOutsideDenied;
		}

		let failureReason = "writes outside allowWrite are read-only";

		if (isHardDenied) {
			failureReason = hardDenialReason;
		} else if (isOutsideDenied) {
			failureReason = "target is outside the project directory";
		}

		blockedNotice = `\n${POLICY_NOTICE} filesystem access blocked by sandbox policy: ${isWriteDenied ? "Write" : "Read"} access to ${offendingPath ?? "target"} is restricted.\nReason: ${failureReason}. Inform the user; do not attempt workarounds.\n`;
	} else {
		const loopbackResult = attributeLoopbackFailure({
			code: exitCode,
			output: outputTail,
			command,
			allowLocalhost,
			platform: process.platform,
			bridgedPorts,
		});

		if (loopbackResult.blocked) {
			const endpoint = loopbackResult.endpoint;
			const endpointString = endpoint?.port ? `${endpoint.host}:${endpoint.port}` : (endpoint?.host ?? "127.0.0.1");
			const serviceName = endpoint?.service;

			auditLayer1Bash({
				subject: endpointString,
				decision: "loopback-refused",
				reason: "Network namespace isolates host loopback under current policy",
				cwd: options?.ctx?.cwd,
				note: serviceName ? `service:${serviceName}` : undefined,
			});

			const notificationMessage = serviceName
				? `Local network notice: connection to ${serviceName} (${endpointString}) was blocked by security policy.`
				: `Local network notice: connection to host ${endpointString} was blocked by security policy.`;

			options?.ctx?.ui?.notify?.(notificationMessage, "warning");

			blockedNotice = `\n${POLICY_NOTICE} Connection to ${endpointString}${serviceName ? ` (${serviceName})` : ""} blocked by sandbox policy.\nReason: Local network connections are restricted. Inform the user; do not attempt workarounds.\n`;
		}
	}

	const emitBlockedNotice = (): void => {
		if (!blockedNotice) {
			return;
		}

		onData(Buffer.from(blockedNotice));
		blockedNotice = "";
	};

	const writeGrantParent = offendingPath ? dirname(offendingPath) : undefined;
	const isNamedInCommand = offendingPath
		? commandMentionsPath(command, offendingPath, workingDirectory, homedir())
		: false;
	const isWriteGrantRepeated =
		offendingPath !== undefined &&
		(grantedWriteFolders.has(dirname(offendingPath)) || grantedWriteFiles.has(offendingPath));

	let decisionNotice = "";

	if (
		isSandboxSetupError &&
		!isHardDenied &&
		!isOutsideDenied &&
		(!offendingPath || offendingPath === workingDirectory || offendingPath.startsWith(`${workingDirectory}/`))
	) {
		blockedNotice = "";

		auditLayer1Bash({
			subject: offendingPath ?? spelledOffendingPath,
			decision: "write-denied",
			reason: "the OS sandbox could not start (bwrap mount setup)",
			cwd: options?.ctx?.cwd,
			note: "sandbox-setup-error",
		});

		options?.ctx?.ui?.notify?.(
			`Sandbox setup notice: could not prepare folder isolation for ${offendingPath ?? spelledOffendingPath ?? "the sandbox"}. System defaults will be used.`,
			"warning",
		);

		decisionNotice = `\n[System Error] sandbox: the OS sandbox could not start (bwrap could not create a protected mount point), so nothing was permission-prompted. This is a sandbox setup problem, not a policy denial.\n`;
		onData(Buffer.from(decisionNotice));
		return { wasHandled: false };
	}

	if (
		offendingPath &&
		isOutsideDenied &&
		!isHardDenied &&
		outsideReadMode === "ask" &&
		options?.ctx?.hasUI &&
		options.ctx.ui?.select &&
		options.onAlwaysRead
	) {
		const targetAbsolutePath = offendingPath;
		let askError: unknown;
		let timedOut = false;

		try {
			const askContext = options.ctx as AskCtx;
			const parentDirectory = dirname(targetAbsolutePath);
			const folderGrant = isSafeFolderGrant(parentDirectory, homedir()) ? parentDirectory : null;

			const promptBody = buildFilePromptFields({
				file: targetAbsolutePath,
				link: spelledOffendingPath,
				command,
				why: "outside your project, not on your allowed list",
			});

			const rememberPromptBody = buildRememberFileFields({
				file: targetAbsolutePath,
				link: spelledOffendingPath,
				folder: parentDirectory,
				commandName: extractBinaryName(command),
				untrusted: !projectTrusted(workingDirectory),
			});

			const { choice, grant } = await askMainWithRemember(
				askContext,
				"Let this command read a file outside your project?",
				promptBody,
				{ session: true, remember: isNamedInCommand },
				() =>
					askRememberFile(
						askContext,
						"Always allow reading — what, and where?",
						rememberPromptBody,
						targetAbsolutePath,
						folderGrant,
						{ icon: "save", untrusted: !projectTrusted(workingDirectory) },
					),
			);

			if (choice === MainChoice.TimedOut) {
				timedOut = true;
			}

			if (choice === MainChoice.Once || choice === MainChoice.Session) {
				if (choice === MainChoice.Once) {
					readOnce.push(targetAbsolutePath);
				} else {
					sessionReadGrants.push(targetAbsolutePath);
				}

				auditLayer1Bash({
					subject: targetAbsolutePath,
					decision: choice,
					scope: choice === MainChoice.Once ? "invocation" : "session",
					cwd: options.ctx.cwd,
					note: "outside-project-read",
				});

				const scopeNotice = choice === MainChoice.Once ? "once" : "for this conversation";
				notifyRecoveryNote(
					options,
					`Allowed read ${scopeNotice}: ${targetAbsolutePath}`,
					`sandbox: allowed read of ${targetAbsolutePath} ${scopeNotice}`,
				);

				onData(
					Buffer.from(
						`\n[Permission Granted] sandbox: read of ${targetAbsolutePath} allowed ${scopeNotice}. Command output with the new permission follows.\n`,
					),
				);

				return { wasHandled: true, retryPromise: retryExecution([]) };
			}

			if (choice === MainChoice.Remember && grant) {
				const subject = grant.folder ? parentDirectory : targetAbsolutePath;

				try {
					const persistedTo = await options.onAlwaysRead(subject, grant.scope);

					auditLayer1Bash({
						subject,
						granularity: grant.folder ? "folder" : "file",
						original: targetAbsolutePath,
						decision: grant.scope === "cwd" ? "always-cwd" : "always-global",
						scope: grant.scope,
						cwd: options.ctx.cwd,
						persisted_to: persistedTo,
						note: "outside-project-read",
					});

					const folderLabel = grant.folder ? ", folder" : "";
					notifyRecoveryNote(
						options,
						`Rule saved for ${grant.scope}: ${subject}`,
						`sandbox: allowed read of ${subject} (${grant.scope}${folderLabel})`,
					);

					onData(
						Buffer.from(
							`\n[Permission Granted] sandbox: read of ${subject} allowed (${grant.scope}${folderLabel}). Command output with the new permission follows.\n`,
						),
					);

					return { wasHandled: true, retryPromise: retryExecution([]) };
				} catch (error) {
					auditLayer1Bash({
						subject,
						scope: grant.scope,
						cwd: options.ctx.cwd,
						error: String(error),
						note: "outside-project-read",
					});

					decisionNotice = `\n[Security Notice] sandbox: could not save the permission (${error}). ${subject} remains blocked.\n`;
				}
			}
		} catch (error) {
			askError = error;
		}

		if (!decisionNotice) {
			if (timedOut) {
				auditLayer1Bash({
					subject: targetAbsolutePath,
					decision: "no",
					note: "outside-project-read-timeout",
					cwd: options.ctx.cwd,
				});
				notifyPromptTimeout(options.ctx as AskCtx, options.toolCallId);
				decisionNotice = `\n${formatBlockedLine("Read", formatTimeoutNote().toLowerCase(), "read")}\n`;
			} else {
				const auditEntry: Record<string, unknown> = {
					subject: targetAbsolutePath,
					decision: "no",
					note: askError ? "ask-error" : "outside-project-read-denied",
					cwd: options.ctx.cwd,
				};

				if (askError) {
					auditEntry.error = String(askError);
				}

				auditLayer1Bash(auditEntry);

				decisionNotice = `\n${formatBlockedLine("Read", "outside the project", "read")}\n`;
			}
		}

		onData(Buffer.from(decisionNotice));
		emitBlockedNotice();
		return { wasHandled: false };
	}

	if (offendingPath && isReadDenied) {
		const failureReason = isHardDenied ? hardDenialReason : "outside the project";
		const action: "Read" | "Write" = isWriteDenied ? "Write" : "Read";
		const outcome = action === "Write" ? "written" : "read";

		auditLayer1Bash({
			subject: offendingPath,
			decision: isReadDenied && !isWriteDenied ? "read-denied" : "write-denied",
			reason: failureReason,
			cwd: workingDirectory,
		});

		options?.ctx?.ui?.notify?.(
			`Folder protected: unable to ${action.toLowerCase()} ${offendingPath}. Location is restricted under current policy.`,
			"warning",
		);

		decisionNotice = `\n${formatBlockedLine(action, failureReason, outcome)}\n`;
		onData(Buffer.from(decisionNotice));
		emitBlockedNotice();
		return { wasHandled: false };
	}

	if (offendingPath && isWriteGrantRepeated && writeGrantParent) {
		auditLayer1Bash({
			subject: offendingPath,
			decision: "write-denied",
			reason: `grant for ${writeGrantParent} did not take effect`,
			cwd: options?.ctx?.cwd,
			note: "grant-ineffective",
		});

		const targetFolder = (writeGrantParent || offendingPath || "").replace(/\/EROFS$/i, "");

		options?.ctx?.ui?.notify?.(
			`🚧  Folder protected: unable to write to ${targetFolder} under sandbox policy. Review sandbox.json or /permission-mode.`,
			"warning",
		);

		decisionNotice = `\n${formatBlockedLine("Write", `the grant for ${writeGrantParent} did not take effect`, "written")}\n`;
		onData(Buffer.from(decisionNotice));
		emitBlockedNotice();
		return { wasHandled: false };
	}

	if (offendingPath && options?.ctx?.hasUI && options.ctx.ui?.select && options.onAlways) {
		const targetAbsolutePath = offendingPath;
		const parentDirectory = dirname(targetAbsolutePath);
		const isAlreadyGranted = writeOnce.includes(parentDirectory) || sessionWriteGrants.includes(parentDirectory);
		let askError: unknown;
		let timedOut = false;

		try {
			const askContext = options.ctx as AskCtx;
			const folderGrant = isSafeFolderGrant(parentDirectory, homedir()) ? parentDirectory : null;
			const deniedWhy = isWriteDenied ? "not under an allowWrite root" : "blocked by the sandbox filesystem policy";

			const promptBody = buildFilePromptFields({
				file: targetAbsolutePath,
				link: spelledOffendingPath,
				command,
				why: deniedWhy,
			});

			const rememberPromptBody = buildRememberFileFields({
				file: targetAbsolutePath,
				link: spelledOffendingPath,
				folder: parentDirectory,
				commandName: extractBinaryName(command),
				untrusted: !projectTrusted(workingDirectory),
			});

			const { choice, grant } = await askMainWithRemember(
				askContext,
				`Let ${extractBinaryName(command)} save files in ${parentDirectory}/?`,
				promptBody,
				{ session: true, once: !isAlreadyGranted, remember: isNamedInCommand },
				() =>
					askRememberFile(
						askContext,
						"Always allow saving — what, and where?",
						rememberPromptBody,
						targetAbsolutePath,
						folderGrant,
						{ icon: "save", untrusted: !projectTrusted(workingDirectory) },
					),
			);

			if (choice === MainChoice.TimedOut) {
				timedOut = true;
			}

			if (choice === MainChoice.Once) {
				grantedWriteFolders.add(parentDirectory);

				auditLayer1Bash({
					subject: targetAbsolutePath,
					granularity: "folder",
					original: targetAbsolutePath,
					decision: "once",
					scope: "invocation",
					cwd: options.ctx.cwd,
					note: "write-once",
				});

				notifyRecoveryNote(
					options,
					`Allowed write once: ${targetAbsolutePath}`,
					`sandbox: allowed write to ${targetAbsolutePath} once`,
				);
				onData(
					Buffer.from(
						`\n[Permission Granted] sandbox: write to ${targetAbsolutePath} allowed once. Command output with the new permission follows.\n`,
					),
				);

				return { wasHandled: true, retryPromise: retryExecution([...writeOnce, parentDirectory]) };
			}

			if (choice === MainChoice.Session) {
				const value = isSafeFolderGrant(parentDirectory, homedir()) ? parentDirectory : targetAbsolutePath;
				sessionWriteGrants.push(value);
				(value === parentDirectory ? grantedWriteFolders : grantedWriteFiles).add(value);

				auditLayer1Bash({
					subject: value,
					granularity: value === parentDirectory ? "folder" : "file",
					original: targetAbsolutePath,
					decision: "session",
					scope: "session",
					cwd: options.ctx.cwd,
					note: "write-session",
				});

				notifyRecoveryNote(
					options,
					`Allowed write for this conversation: ${value}`,
					`sandbox: allowed write to ${value} for this conversation`,
				);
				onData(
					Buffer.from(
						`\n[Permission Granted] sandbox: write to ${value} allowed for this conversation. Command output with the new permission follows.\n`,
					),
				);

				return { wasHandled: true, retryPromise: retryExecution([]) };
			}

			if (choice === MainChoice.Remember && grant) {
				const subject = grant.folder ? parentDirectory : targetAbsolutePath;

				try {
					const persistedTo = await options.onAlways(subject, grant.scope);
					(grant.folder ? grantedWriteFolders : grantedWriteFiles).add(subject);

					auditLayer1Bash({
						subject,
						granularity: grant.folder ? "folder" : "file",
						original: targetAbsolutePath,
						decision: grant.scope === "cwd" ? "always-cwd" : "always-global",
						scope: grant.scope,
						cwd: options.ctx.cwd,
						persisted_to: persistedTo,
					});

					const folderLabel = grant.folder ? ", folder" : "";
					notifyRecoveryNote(
						options,
						`Rule saved for ${grant.scope}: ${subject}`,
						`sandbox: allowed write to ${subject} (${grant.scope}${folderLabel})`,
					);
					onData(
						Buffer.from(
							`\n[Permission Granted] sandbox: write to ${subject} allowed (${grant.scope}${folderLabel}). Command output with the new permission follows.\n`,
						),
					);

					return { wasHandled: true, retryPromise: retryExecution([]) };
				} catch (error) {
					auditLayer1Bash({
						subject,
						granularity: grant.folder ? "folder" : "file",
						original: targetAbsolutePath,
						scope: grant.scope,
						cwd: options.ctx.cwd,
						error: String(error),
					});

					options.ctx.ui?.notify?.(`sandbox: could not save the permission (${error})`, "error");
					decisionNotice = `\n[Security Notice] sandbox: could not save the permission (${error}). ${subject} remains blocked.\n`;
				}
			}
		} catch (error) {
			askError = error;
		}

		if (!decisionNotice) {
			if (timedOut) {
				auditLayer1Bash({
					subject: targetAbsolutePath,
					decision: "no",
					note: "timeout",
					cwd: options.ctx.cwd,
				});
				notifyPromptTimeout(options.ctx as AskCtx, options.toolCallId);
				decisionNotice = `\n${formatBlockedLine("Write", formatTimeoutNote().toLowerCase(), "written")}\n`;
			} else {
				const auditEntry: Record<string, unknown> = {
					subject: targetAbsolutePath,
					decision: "no",
					note: askError ? "ask-error" : "user-denied",
					cwd: options.ctx.cwd,
				};

				if (askError) {
					auditEntry.error = String(askError);
				}

				auditLayer1Bash(auditEntry);

				decisionNotice = `\n${formatBlockedLine("Write", askError ? "the permission prompt failed" : "user denied", "written")}\n`;
			}
		}

		onData(Buffer.from(decisionNotice));
		emitBlockedNotice();
		return { wasHandled: false };
	}

	if (offendingPath && isWriteDenied) {
		auditLayer1Bash({
			subject: offendingPath,
			decision: "write-denied",
			reason: "not under any allowWrite root",
			cwd: workingDirectory,
		});

		options?.ctx?.ui?.notify?.(
			`Folder protected: unable to write to ${offendingPath}. Location is outside allowed project folders.`,
			"warning",
		);

		emitBlockedNotice();
		return { wasHandled: false };
	}

	emitBlockedNotice();
	return { wasHandled: false };
}
