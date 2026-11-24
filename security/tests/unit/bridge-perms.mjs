import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { piScratchDirectory } from "#l1-sandbox/scratch.ts";
import {
	injectBridgesIntoBwrap,
	injectSocketBridgesIntoBwrap,
	startHostPortBridge,
	startHostSocketBridge,
} from "#l1-sandbox/host-bridge.ts";

let pass = 0;
let fail = 0;
const check = (name, condition, extra = "") => {
	if (condition) pass++;
	else {
		fail++;
		console.log("FAIL:", name, "→", extra);
	}
};

const throws = (call) => {
	try {
		call();
		return false;
	} catch {
		return true;
	}
};

const userIdentifier = process.getuid?.() ?? 0;
const scratchPath = piScratchDirectory();
const scratchStats = fs.statSync(scratchPath);
const bridgePort = 3333;

check("the scratch path is <tmp>/pi-<uid>", scratchPath.endsWith(`/pi-${userIdentifier}`), scratchPath);
check("the scratch path is a directory", scratchStats.isDirectory());
check("the scratch directory is owner-only", (scratchStats.mode & 0o077) === 0, scratchStats.mode.toString(8));

// An existing directory that is too permissive is tightened, not trusted.
const looseRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-scratch-loose-"));
const looseDirectory = path.join(looseRoot, `pi-${userIdentifier}`);
fs.mkdirSync(looseDirectory, { mode: 0o755 });
fs.chmodSync(looseDirectory, 0o755);
const adoptedDirectory = piScratchDirectory(looseRoot);

check("an adopted directory is chmodded to 0700", (fs.statSync(adoptedDirectory).mode & 0o077) === 0);
check("an adopted directory is the same path", adoptedDirectory === looseDirectory);

// `/tmp` is shared, so owning the name is not the same as owning the directory.
const symlinkRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-scratch-symlink-"));
fs.mkdirSync(path.join(symlinkRoot, "elsewhere"));
fs.symlinkSync(path.join(symlinkRoot, "elsewhere"), path.join(symlinkRoot, `pi-${userIdentifier}`));

check("a symlinked scratch path is rejected", throws(() => piScratchDirectory(symlinkRoot)));

const fileRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-scratch-file-"));
fs.writeFileSync(path.join(fileRoot, `pi-${userIdentifier}`), "");

check("a file in the scratch path is rejected", throws(() => piScratchDirectory(fileRoot)));

const portBridge = await startHostPortBridge(bridgePort);
const portSocketStats = fs.statSync(portBridge.sockPath);

check("the port bridge socket lives in the scratch directory", path.dirname(portBridge.sockPath) === scratchPath);
check("the port bridge socket is owner-only", (portSocketStats.mode & 0o077) === 0, portSocketStats.mode.toString(8));
check("the port bridge path is a socket", portSocketStats.isSocket());

portBridge.close();
check("the port bridge socket is removed on close", !fs.existsSync(portBridge.sockPath));

const daemonBridge = await startHostSocketBridge("DOCKER_HOST", path.join(os.tmpdir(), "absent-target.sock"));
const daemonSocketStats = fs.statSync(daemonBridge.sockPath);

check("the daemon bridge socket lives in the scratch directory", path.dirname(daemonBridge.sockPath) === scratchPath);
check("the daemon bridge socket is owner-only", (daemonSocketStats.mode & 0o077) === 0, daemonSocketStats.mode.toString(8));

daemonBridge.close();
check("the daemon bridge socket is removed on close", !fs.existsSync(daemonBridge.sockPath));

const rawCommand = "bwrap --new-session --unshare-net --ro-bind / / -- /usr/bin/bash -c 'socat TCP-LISTEN:3128,fork,reuseaddr UNIX-CONNECT:/tmp/http.sock'";
const injectedPorts = injectBridgesIntoBwrap(rawCommand, [{ port: bridgePort, sockPath: portBridge.sockPath, close: () => {} }]);
const injectedSockets = injectSocketBridgesIntoBwrap(rawCommand, [
	{ envName: "DOCKER_HOST", targetPath: "/var/run/docker.sock", sockPath: daemonBridge.sockPath, close: () => {} },
]);

if (process.platform === "linux") {
	check("the port bridge is bind-mounted from the scratch path", injectedPorts.includes(`--bind ${portBridge.sockPath} ${portBridge.sockPath}`));
	check("the daemon bridge is bind-mounted from the scratch path", injectedSockets.includes(`--bind ${daemonBridge.sockPath} ${daemonBridge.sockPath}`));
	check("the daemon client is pointed at the scratch path", injectedSockets.includes(`--setenv DOCKER_HOST unix://${daemonBridge.sockPath}`));
} else {
	check("port injection is a no-op off Linux", injectedPorts === rawCommand);
	check("socket injection is a no-op off Linux", injectedSockets === rawCommand);
}

for (const directory of [looseRoot, symlinkRoot, fileRoot]) {
	fs.rmSync(directory, { recursive: true, force: true });
}

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
