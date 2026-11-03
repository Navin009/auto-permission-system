import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { type BashOperations } from "@earendil-works/pi-coding-agent";
import { sandboxFilesystem } from "../core/index.ts";
import { loadConfig } from "./config.ts";
import { injectBridgesIntoBwrap, startHostPortBridges, type HostPortBridge } from "./host-bridge.ts";
import {
	cleanupWorkspaceArtifacts,
	stripNonExistentWorkspaceMounts,
} from "./bash-artifacts.ts";
import {
	clearFilesystemSessionGrants,
	filesystemSessionGrantSummary,
	preflightAskReads,
	preflightOutsideReads,
	preflightSensitiveCommands,
	sessionReadGrants,
	sessionWriteGrants,
	type SandboxedBashOptions,
	type SandboxedBashOpts,
} from "./bash-preflight.ts";
import { handleBlockedBashExecution } from "./bash-recovery.ts";

export {
	cleanupWorkspaceArtifacts,
	clearFilesystemSessionGrants,
	filesystemSessionGrantSummary,
	stripNonExistentWorkspaceMounts,
	type SandboxedBashOptions,
	type SandboxedBashOpts,
};

const DEFAULT_KILL_TIMEOUT_MILLISECONDS = 1000;

export function createSandboxedBashOps(options?: SandboxedBashOptions): BashOperations {
	return {
		async exec(command, workingDirectory, { onData, signal, timeout }) {
			if (!existsSync(workingDirectory)) {
				throw new Error(`Working directory does not exist: ${workingDirectory}`);
			}

			const sensitiveCommandResult = await preflightSensitiveCommands(
				command,
				workingDirectory,
				options,
				onData,
			);

			if (sensitiveCommandResult) {
				return sensitiveCommandResult;
			}

			const askReadResult = await preflightAskReads(command, workingDirectory, options, onData);

			if (askReadResult) {
				return askReadResult;
			}

			const outsideReadResult = await preflightOutsideReads(command, workingDirectory, options, onData);

			if (outsideReadResult && "blocked" in outsideReadResult) {
				return outsideReadResult.blocked;
			}

			const readOnce = [...(outsideReadResult?.once ?? [])];

			const buildCustomConfig = (writeOnce: string[]): Partial<SandboxRuntimeConfig> => {
				const readRoots = [...readOnce, ...sessionReadGrants];
				const writeRoots = [...writeOnce, ...sessionWriteGrants];
				const freshConfig = loadConfig(workingDirectory).filesystem ?? {
					denyRead: [],
					allowWrite: [],
					denyWrite: [],
				};

				return {
					filesystem: sandboxFilesystem(
						{
							...freshConfig,
							allowRead: [...(freshConfig.allowRead ?? []), ...readRoots],
							allowWrite: [...freshConfig.allowWrite, ...writeRoots],
						},
						{ cwd: workingDirectory, home: homedir() },
					),
				};
			};

			const userIdentifier = process.getuid?.() ?? 0;
			const temporaryBaseDirectory = existsSync("/private/tmp") ? "/private/tmp" : "/tmp";
			const temporaryDirectory = `${temporaryBaseDirectory}/pi-${userIdentifier}`;

			const grantedWriteFolders = new Set<string>();
			const grantedWriteFiles = new Set<string>();

			const attemptExecution = async (writeOnce: string[]): Promise<{ exitCode: number | null }> => {
				const sandboxConfig = loadConfig(workingDirectory);
				const allowLocalhost =
					sandboxConfig.allowLocalhost ?? sandboxConfig.network?.allowLocalhost ?? true;

				let bridges: HostPortBridge[] = [];

				if (!allowLocalhost && process.platform === "linux") {
					const hostPorts = sandboxConfig.bridgeHostPorts ?? [3274];
					bridges = await startHostPortBridges(hostPorts);
				}

				const rawWrapped = await SandboxManager.wrapWithSandbox(
					command,
					undefined,
					buildCustomConfig(writeOnce),
				);

				let wrappedCommand = rawWrapped;

				if (process.platform === "linux") {
					if (allowLocalhost) {
						wrappedCommand = wrappedCommand.replace(" --unshare-net ", " ");
					} else if (bridges.length > 0) {
						wrappedCommand = injectBridgesIntoBwrap(wrappedCommand, bridges);
					}

					wrappedCommand = stripNonExistentWorkspaceMounts(wrappedCommand, workingDirectory);
				}

				const cleanupBridges = () => {
					bridges.forEach((bridge) => bridge.close());
				};

				return new Promise((resolve, reject) => {
					const child = spawn("bash", ["-c", wrappedCommand], {
						cwd: workingDirectory,
						detached: true,
						stdio: ["ignore", "pipe", "pipe"],
						env: { ...process.env, TMPDIR: `${temporaryDirectory}/` },
					});

					let timeoutHandle: NodeJS.Timeout | undefined;

					if (timeout !== undefined && timeout > 0) {
						timeoutHandle = setTimeout(() => {
							if (child.pid) {
								try {
									process.kill(-child.pid, "SIGKILL");
								} catch {
									child.kill("SIGKILL");
								}
							}
						}, timeout * DEFAULT_KILL_TIMEOUT_MILLISECONDS);
					}

					let outputTail = "";

					const captureOutput = (chunk: Buffer | string) => {
						outputTail = (outputTail + chunk.toString()).slice(-2048);
						onData(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
					};

					child.stdout?.on("data", captureOutput);
					child.stderr?.on("data", captureOutput);

					child.on("error", (error) => {
						if (timeoutHandle) {
							clearTimeout(timeoutHandle);
						}

						cleanupBridges();
						SandboxManager.cleanupAfterCommand();
						cleanupWorkspaceArtifacts(workingDirectory);
						reject(error);
					});

					const onAbort = () => {
						cleanupBridges();

						if (child.pid) {
							try {
								process.kill(-child.pid, "SIGKILL");
							} catch {
								child.kill("SIGKILL");
							}
						}
					};

					signal?.addEventListener("abort", onAbort, { once: true });

					child.on("close", async (exitCode) => {
						if (timeoutHandle) {
							clearTimeout(timeoutHandle);
						}

						signal?.removeEventListener("abort", onAbort);
						cleanupBridges();

						SandboxManager.cleanupAfterCommand();
						cleanupWorkspaceArtifacts(workingDirectory);

						const outcome = await handleBlockedBashExecution({
							exitCode,
							outputTail,
							command,
							workingDirectory,
							allowLocalhost,
							bridgedPorts: bridges.map((bridge) => bridge.port),
							options,
							writeOnce,
							readOnce,
							grantedWriteFolders,
							grantedWriteFiles,
							onData,
							retryExecution: (additionalWriteGrants) => attemptExecution(additionalWriteGrants),
						});

						if (outcome.wasHandled && outcome.retryPromise) {
							resolve(outcome.retryPromise);
							return;
						}

						resolve({ exitCode });
					});
				});
			};

			return attemptExecution([]);
		},
	};
}
