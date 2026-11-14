// Host loopback bridge tests: verify Unix socket forwarding and bwrap command injection.
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	daemonClientHeads,
	hostDaemonSockets,
	injectBridgesIntoBwrap,
	injectNpmProxyEnv,
	injectSocketBridgesIntoBwrap,
	startHostPortBridge,
	startHostSocketBridge,
} from '../../../src/l1-sandbox/host-bridge.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

// Test 1: injectBridgesIntoBwrap formatting
const fakeBridges = [
	{ port: 3274, sockPath: '/tmp/test-3274.sock', close: () => {} },
	{ port: 8080, sockPath: '/tmp/test-8080.sock', close: () => {} },
];

const mockRawWrapped = "bwrap --new-session --unshare-net --ro-bind / / -- /usr/bin/bash -c '/usr/bin/bash -c \"socat TCP-LISTEN:3128,fork,reuseaddr UNIX-CONNECT:/tmp/http.sock >/dev/null 2>&1 &\ntrap \\'rc=$?; kill %1 %2 2>/dev/null; exit $rc\\' EXIT\necho hello\"'";

const injected = injectBridgesIntoBwrap(mockRawWrapped, fakeBridges);

if (process.platform === 'linux') {
	check('injected includes --bind for 3274', injected.includes('--bind /tmp/test-3274.sock /tmp/test-3274.sock'));
	check('injected includes --bind for 8080', injected.includes('--bind /tmp/test-8080.sock /tmp/test-8080.sock'));
	check('injected includes socat TCP-LISTEN:3274', injected.includes('socat TCP-LISTEN:3274,fork,reuseaddr UNIX-CONNECT:/tmp/test-3274.sock'));
	check('injected includes socat TCP-LISTEN:8080', injected.includes('socat TCP-LISTEN:8080,fork,reuseaddr UNIX-CONNECT:/tmp/test-8080.sock'));
	check('injected cleans up bridge pids in trap', injected.includes('kill %1 %2 $_pi_bridge_pids 2>/dev/null;'));
} else {
	check('noop on non-linux', injected === mockRawWrapped);
}

check('empty bridges returns unchanged', injectBridgesIntoBwrap(mockRawWrapped, []) === mockRawWrapped);

// Test 2: startHostPortBridge lifecycle & forwarding
const mockTarget = net.createServer((c) => {
	c.on('data', (d) => {
		c.write(`ECHO:${d.toString()}`);
	});
});

await new Promise((resolve) => mockTarget.listen(0, '127.0.0.1', resolve));
const targetPort = mockTarget.address().port;

const bridge = await startHostPortBridge(targetPort);
check('bridge sockPath created', fs.existsSync(bridge.sockPath));

// Connect through bridge Unix socket
const client = net.connect(bridge.sockPath);
let received = '';
await new Promise((resolve) => {
	client.on('connect', () => {
		client.write('hello-bridge');
	});
	client.on('data', (d) => {
		received += d.toString();
		client.end();
		resolve();
	});
});

check('data forwarded through bridge', received === 'ECHO:hello-bridge');

// Close bridge
bridge.close();
mockTarget.close();
check('bridge socket removed after close', !fs.existsSync(bridge.sockPath));

// ─── daemon socket bridge (docker / podman) ────────────────────────────────

check('a docker command needs the daemon bridge', daemonClientHeads('docker ps').includes('docker'));
check('the client is found after a cd', daemonClientHeads('cd app && podman compose up').includes('podman'));
check('an unrelated command needs no bridge', daemonClientHeads('npm run build').length === 0);
check('a mention in an argument is not a client', daemonClientHeads('cat docker.md').length === 0);

const daemonTarget = net.createServer((c) => c.end('daemon-ok'));
const daemonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-daemon-target-'));
const daemonSocket = path.join(daemonDir, 'daemon.sock');
await new Promise((resolve) => daemonTarget.listen(daemonSocket, resolve));

process.env.DOCKER_HOST = `unix://${daemonSocket}`;
const targets = hostDaemonSockets();
check('the configured endpoint wins', targets[0]?.targetPath === daemonSocket, JSON.stringify(targets));
check('one bridge per client variable', new Set(targets.map((t) => t.envName)).size === targets.length);

const daemonBridge = await startHostSocketBridge('DOCKER_HOST', daemonSocket);
check('the bridged socket belongs to the user', (fs.statSync(daemonBridge.sockPath).mode & 0o077) === 0, fs.statSync(daemonBridge.sockPath).mode.toString(8));

const daemonReply = await new Promise((resolve) => {
	const client = net.connect(daemonBridge.sockPath);
	let payload = '';
	client.on('data', (d) => (payload += d.toString()));
	client.on('end', () => resolve(payload));
});
check('daemon traffic is forwarded', daemonReply === 'daemon-ok', daemonReply);

daemonBridge.close();
daemonTarget.close();
check('daemon bridge socket removed after close', !fs.existsSync(daemonBridge.sockPath));
delete process.env.DOCKER_HOST;

const socketMock = 'bwrap --new-session --ro-bind / / -- /usr/bin/bash -c "docker ps"';
const socketInjected = injectSocketBridgesIntoBwrap(socketMock, [
	{ envName: 'DOCKER_HOST', targetPath: '/var/run/docker.sock', sockPath: '/tmp/pi-daemon.sock', close: () => {} },
]);
if (process.platform === 'linux') {
	check('the bridged socket is bound in', socketInjected.includes('--bind /tmp/pi-daemon.sock /tmp/pi-daemon.sock'));
	check('the client env points at the bridge', socketInjected.includes('--setenv DOCKER_HOST unix:///tmp/pi-daemon.sock'));
	check('the bridge lands before the command separator', socketInjected.indexOf('--setenv DOCKER_HOST') < socketInjected.lastIndexOf(' -- '));
} else {
	check('socket injection is a no-op off linux', socketInjected === socketMock);
}

check('no bridges leaves the command unchanged', injectSocketBridgesIntoBwrap(socketMock, []) === socketMock);

// ─── npm proxy credentials ────────────────────────────────────────────────

const proxyMock = 'bwrap --ro-bind / / --setenv HTTPS_PROXY http://cmd:secret@localhost:3128 -- /usr/bin/bash -c "npm ci"';
const proxyInjected = injectNpmProxyEnv(proxyMock);
if (process.platform === 'linux') {
	check('npm gets the proxy it would otherwise drop', proxyInjected.includes('--setenv npm_config_https_proxy http://cmd:secret@localhost:3128'));
	check('the http proxy key is set too', proxyInjected.includes('--setenv npm_config_proxy http://cmd:secret@localhost:3128'));
	check('npm injection happens once', injectNpmProxyEnv(proxyInjected) === proxyInjected);
} else {
	check('npm injection is a no-op off linux', proxyInjected === proxyMock);
}

check('no proxy means nothing to inject', injectNpmProxyEnv('bwrap --ro-bind / / -- bash -c "npm ci"') === 'bwrap --ro-bind / / -- bash -c "npm ci"');

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
