// Host loopback bridge tests: verify Unix socket forwarding and bwrap command injection.
import net from 'node:net';
import fs from 'node:fs';
import { injectBridgesIntoBwrap, startHostPortBridge } from '../../../src/l1-sandbox/host-bridge.ts';

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

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
