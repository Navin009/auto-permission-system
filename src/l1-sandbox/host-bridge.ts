import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, statSync, unlinkSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { commandHead, commandSegments, shellTokens } from "#core/index.ts";
import { piScratchDirectory } from "./scratch.ts";

const SOCKET_FILE_MODE = 0o600;

export interface HostPortBridge {
	port: number;
	sockPath: string;
	close: () => void;
}

export interface HostSocketBridge {
	envName: string;
	targetPath: string;
	sockPath: string;
	close: () => void;
}

const DAEMON_CLIENT_HEADS = new Set([
	"docker",
	"docker-compose",
	"podman",
	"podman-compose",
	"nerdctl",
	"buildah",
	"skopeo",
]);

const UNIX_SOCKET_PREFIX = "unix://";

export function daemonClientHeads(command: string): string[] {
	const heads: string[] = [];

	for (const segment of commandSegments(command)) {
		const { head } = commandHead(shellTokens(segment));

		if (DAEMON_CLIENT_HEADS.has(head)) heads.push(head);
	}

	return heads;
}

function isUnixSocket(path: string): boolean {
	try {
		return statSync(path).isSocket();
	} catch {
		return false;
	}
}

function socketPathFromEnv(name: string): string | undefined {
	const value = process.env[name];

	if (!value?.startsWith(UNIX_SOCKET_PREFIX)) return undefined;

	return value.slice(UNIX_SOCKET_PREFIX.length);
}

export function hostDaemonSockets(
	userIdentifier: number = process.getuid?.() ?? 0,
): { envName: string; targetPath: string }[] {
	const candidates: { envName: string; targetPath: string | undefined }[] = [
		{ envName: "DOCKER_HOST", targetPath: socketPathFromEnv("DOCKER_HOST") },
		{ envName: "CONTAINER_HOST", targetPath: socketPathFromEnv("CONTAINER_HOST") },
		{ envName: "DOCKER_HOST", targetPath: `/run/user/${userIdentifier}/docker.sock` },
		{ envName: "CONTAINER_HOST", targetPath: `/run/user/${userIdentifier}/podman/podman.sock` },
		{ envName: "DOCKER_HOST", targetPath: "/var/run/docker.sock" },
		{ envName: "CONTAINER_HOST", targetPath: "/run/podman/podman.sock" },
	];

	const resolved: { envName: string; targetPath: string }[] = [];
	const seenNames = new Set<string>();

	for (const { envName, targetPath } of candidates) {
		if (!targetPath || seenNames.has(envName)) continue;
		if (!isUnixSocket(targetPath)) continue;

		seenNames.add(envName);
		resolved.push({ envName, targetPath });
	}

	return resolved;
}

export async function startHostSocketBridge(envName: string, targetPath: string): Promise<HostSocketBridge> {
	const id = randomBytes(6).toString("hex");
	const sockPath = join(piScratchDirectory(), `pi-daemon-bridge-${id}.sock`);

	const server = net.createServer((client) => {
		const target = net.connect(targetPath);

		client.pipe(target).pipe(client);
		client.on("error", () => target.destroy());
		target.on("error", () => client.destroy());
	});

	await new Promise<void>((resolve, reject) => {
		server.listen(sockPath, () => resolve());
		server.on("error", reject);
	});

	chmodSync(sockPath, SOCKET_FILE_MODE);

	return {
		envName,
		targetPath,
		sockPath,
		close: () => {
			try {
				server.close();
			} catch (error) {
				void error;
			}
			try {
				if (existsSync(sockPath)) unlinkSync(sockPath);
			} catch (error) {
				void error;
			}
		},
	};
}

export async function startHostSocketBridges(
	targets: { envName: string; targetPath: string }[],
): Promise<HostSocketBridge[]> {
	if (process.platform !== "linux" || !targets.length) return [];

	return Promise.all(targets.map((target) => startHostSocketBridge(target.envName, target.targetPath)));
}

export function injectSocketBridgesIntoBwrap(wrappedCommand: string, bridges: HostSocketBridge[]): string {
	if (process.platform !== "linux" || !bridges.length) return wrappedCommand;

	const dashIndex = wrappedCommand.indexOf(" -- ");

	if (dashIndex === -1) return wrappedCommand;

	const binds = bridges.map((bridge) => `--bind ${bridge.sockPath} ${bridge.sockPath}`).join(" ");
	const envs = bridges.map((bridge) => `--setenv ${bridge.envName} ${UNIX_SOCKET_PREFIX}${bridge.sockPath}`).join(" ");

	return `${wrappedCommand.slice(0, dashIndex)} ${binds} ${envs} -- ${wrappedCommand.slice(dashIndex + 4)}`;
}

export function injectNpmProxyEnv(wrappedCommand: string): string {
	if (process.platform !== "linux") return wrappedCommand;

	const dashIndex = wrappedCommand.indexOf(" -- ");

	if (dashIndex === -1) return wrappedCommand;

	const bwrapPart = wrappedCommand.slice(0, dashIndex);

	if (bwrapPart.includes("--setenv npm_config_https_proxy")) return wrappedCommand;

	const httpsProxy = /--setenv HTTPS_PROXY (\S+)/.exec(bwrapPart)?.[1];

	if (!httpsProxy) return wrappedCommand;

	const injected = ` --setenv npm_config_proxy ${httpsProxy} --setenv npm_config_https_proxy ${httpsProxy}`;

	return `${bwrapPart}${injected} -- ${wrappedCommand.slice(dashIndex + 4)}`;
}

export async function startHostPortBridge(port: number): Promise<HostPortBridge> {
	const id = randomBytes(6).toString("hex");
	const sockPath = join(piScratchDirectory(), `pi-host-bridge-${port}-${id}.sock`);

	const server = net.createServer((client) => {
		const target = net.connect(port, "127.0.0.1");
		client.pipe(target).pipe(client);
		client.on("error", () => target.destroy());
		target.on("error", () => client.destroy());
	});

	await new Promise<void>((resolve, reject) => {
		server.listen(sockPath, () => resolve());
		server.on("error", reject);
	});

	chmodSync(sockPath, SOCKET_FILE_MODE);

	return {
		port,
		sockPath,
		close: () => {
			try {
				server.close();
			} catch (err) {
				void err;
			}
			try {
				if (existsSync(sockPath)) unlinkSync(sockPath);
			} catch (err) {
				void err;
			}
		},
	};
}

export async function startHostPortBridges(ports: number[]): Promise<HostPortBridge[]> {
	if (process.platform !== "linux" || !ports.length) return [];
	return Promise.all(ports.map((p) => startHostPortBridge(p)));
}

export function injectBridgesIntoBwrap(wrappedCommand: string, bridges: HostPortBridge[]): string {
	if (process.platform !== "linux" || !bridges.length) return wrappedCommand;

	const dashIndex = wrappedCommand.indexOf(" -- ");
	if (dashIndex === -1) return wrappedCommand;

	const binds = bridges.map((b) => `--bind ${b.sockPath} ${b.sockPath}`).join(" ");
	const bwrapPart = `${wrappedCommand.slice(0, dashIndex)} ${binds}`;
	let shellPart = wrappedCommand.slice(dashIndex + 4);

	const socatStarters = bridges
		.map(
			(b) =>
				`socat TCP-LISTEN:${b.port},fork,reuseaddr UNIX-CONNECT:${b.sockPath} >/dev/null 2>&1 &\n_pi_bridge_pids="$_pi_bridge_pids $!"`,
		)
		.join("\n");

	if (shellPart.includes("socat TCP-LISTEN:3128")) {
		shellPart = shellPart.replace("socat TCP-LISTEN:3128", `${socatStarters}\nsocat TCP-LISTEN:3128`);

		shellPart = shellPart.replace("kill %1 %2 2>/dev/null;", "kill %1 %2 $_pi_bridge_pids 2>/dev/null;");
		return `${bwrapPart} -- ${shellPart}`;
	}

	return wrappedCommand;
}
