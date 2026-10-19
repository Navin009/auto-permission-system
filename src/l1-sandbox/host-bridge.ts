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
import { existsSync, unlinkSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface HostPortBridge {
	port: number;
	sockPath: string;
	close: () => void;
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
