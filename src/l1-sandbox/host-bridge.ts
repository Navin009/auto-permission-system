/**
 * Host loopback port bridge for Linux sandbox.
 *
 * Bubblewrap on Linux isolates the network namespace via `--unshare-net`.
 * In that isolated namespace, loopback `127.0.0.1` is disconnected from the host,
 * preventing tools (like Diffusion Studio CLI `dapi` or local dev servers) from
 * reaching services running on the host's localhost (e.g. port 3274).
 *
 * This module creates a lightweight Unix domain socket bridge on the host
 * (using Node's built-in `node:net`), bind-mounts the socket into bwrap,
 * and starts a `socat` listener inside the container forwarding container
 * `127.0.0.1:${port}` to the host service.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, statSync, unlinkSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandHead, commandSegments, shellTokens } from "../core/index.ts";

export interface HostPortBridge {
	port: number;
	sockPath: string;
	close: () => void;
}

/** A daemon socket the sandboxed client reaches through the host, not directly. */
export interface HostSocketBridge {
	envName: string;
	targetPath: string;
	sockPath: string;
	close: () => void;
}

/** Command heads that talk to a daemon over a Unix socket. */
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

/**
 * The daemon clients a command line starts, in order. One segment is enough:
 * `cd app && docker compose up` still needs the socket.
 */
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

/**
 * The daemon sockets to bridge, most specific first. A caller who set
 * `DOCKER_HOST`/`CONTAINER_HOST` keeps that endpoint; otherwise the rootless
 * per-user socket wins over the root-owned one, because it is the one a normal
 * user session already uses.
 */
export function hostDaemonSockets(userIdentifier: number = process.getuid?.() ?? 0): { envName: string; targetPath: string }[] {
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

/**
 * Bridge a host daemon socket to a socket the sandboxed user owns.
 *
 * bubblewrap's `--unshare-user` drops every supplementary group and refuses
 * `setgroups`, so a `/var/run/docker.sock` owned by `root:docker` is unreachable
 * inside the sandbox even though the same user reaches it from a normal shell
 * (ADR-052). Connecting on the host, where the group is intact, and re-exposing
 * a user-owned socket at the same path the client already uses keeps the fence:
 * the filesystem and network policy still apply to everything the client sends.
 */
export async function startHostSocketBridge(envName: string, targetPath: string): Promise<HostSocketBridge> {
	const id = randomBytes(6).toString("hex");
	const sockPath = join(tmpdir(), `pi-daemon-bridge-${id}.sock`);

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

	chmodSync(sockPath, 0o600);

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

/** Bind the bridged sockets into bwrap and point the clients at them. */
export function injectSocketBridgesIntoBwrap(wrappedCommand: string, bridges: HostSocketBridge[]): string {
	if (process.platform !== "linux" || !bridges.length) return wrappedCommand;

	const dashIndex = wrappedCommand.indexOf(" -- ");

	if (dashIndex === -1) return wrappedCommand;

	const binds = bridges.map((bridge) => `--bind ${bridge.sockPath} ${bridge.sockPath}`).join(" ");
	const envs = bridges
		.map((bridge) => `--setenv ${bridge.envName} ${UNIX_SOCKET_PREFIX}${bridge.sockPath}`)
		.join(" ");

	return `${wrappedCommand.slice(0, dashIndex)} ${binds} ${envs} -- ${wrappedCommand.slice(dashIndex + 4)}`;
}

/**
 * Teach npm the proxy the sandbox already gave every other client.
 *
 * sandbox-runtime embeds the proxy credential in `HTTPS_PROXY`, which curl and
 * git use. npm parses that URL itself, drops the userinfo, and answers the
 * proxy's challenge with `E407 Proxy Authentication Required`, so an install
 * that a `curl` to the same registry completes fails (ADR-054). npm's own
 * config keys carry the same URL through a path that keeps the credential.
 */
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

/**
 * Start a Unix domain socket bridge on the host forwarding to host 127.0.0.1:port.
 */
export async function startHostPortBridge(port: number): Promise<HostPortBridge> {
	const id = randomBytes(6).toString("hex");
	const sockPath = join(tmpdir(), `pi-host-bridge-${port}-${id}.sock`);

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

/**
 * Start bridges for multiple ports concurrently.
 */
export async function startHostPortBridges(ports: number[]): Promise<HostPortBridge[]> {
	if (process.platform !== "linux" || !ports.length) return [];
	return Promise.all(ports.map((p) => startHostPortBridge(p)));
}

/**
 * Inject the bridges into the bwrap command invocation on Linux.
 */
export function injectBridgesIntoBwrap(wrappedCommand: string, bridges: HostPortBridge[]): string {
	if (process.platform !== "linux" || !bridges.length) return wrappedCommand;

	const dashIndex = wrappedCommand.indexOf(" -- ");
	if (dashIndex === -1) return wrappedCommand;

	// 1. Add --bind for each socket before " -- "
	const binds = bridges.map((b) => `--bind ${b.sockPath} ${b.sockPath}`).join(" ");
	const bwrapPart = `${wrappedCommand.slice(0, dashIndex)} ${binds}`;
	let shellPart = wrappedCommand.slice(dashIndex + 4);

	// 2. Start socat listeners inside the container
	const socatStarters = bridges
		.map((b) => `socat TCP-LISTEN:${b.port},fork,reuseaddr UNIX-CONNECT:${b.sockPath} >/dev/null 2>&1 &\n_pi_bridge_pids="$_pi_bridge_pids $!"`)
		.join("\n");

	if (shellPart.includes("socat TCP-LISTEN:3128")) {
		shellPart = shellPart.replace("socat TCP-LISTEN:3128", `${socatStarters}\nsocat TCP-LISTEN:3128`);
		// Include our bridge pids in the script EXIT trap cleanup
		shellPart = shellPart.replace("kill %1 %2 2>/dev/null;", "kill %1 %2 $_pi_bridge_pids 2>/dev/null;");
		return `${bwrapPart} -- ${shellPart}`;
	}

	return wrappedCommand;
}
