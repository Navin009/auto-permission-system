// Shipped baseline (sandbox.default.json) + shared policy overlaying. The JSON is the only place default lists live.
import { loadDefaultPolicy, overlayPolicy, shippedPolicy } from '../../../src/core/index.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const d = loadDefaultPolicy();
check('sandbox.default.json is found', d !== null && typeof d === 'object');
const fs = d?.filesystem ?? {};
check('default: outsideProject.read = allow', fs.outsideProject?.read === 'allow');
check('default: key material is hard-denied on read', ['~/.gnupg', '~/.pi/agent/auth.json'].every((p) => (fs.denyRead ?? []).includes(p)));
check('default: credential stores ask on read as folders', ['~/.aws', '~/.kube', '~/.docker', '~/.config/gcloud'].every((p) => (fs.askRead ?? []).includes(p)));
check('default: credential stores are not hard-denied on read', !(fs.denyRead ?? []).some((p) => p === '~/.aws'));
check('default: key material is hard-denied on write', ['~/.ssh', '~/.gnupg', '~/.pi/agent/auth.json'].every((p) => (fs.denyWrite ?? []).includes(p)));
check('default: project files are writable (a write is not a leak)', !(fs.denyWrite ?? []).includes('.env') && !(fs.denyWrite ?? []).includes('*.pem'));
check('default: modelDenyRead is empty', (fs.modelDenyRead ?? []).length === 0);
check('default: credential filenames ask on read', ['id_rsa', '*.pem', '*.key'].every((p) => (fs.askRead ?? []).includes(p)));
check('default: agent secrets ask on read', ['auth.json', 'mcp.json', 'mcp-auth.json'].every((p) => (fs.askRead ?? []).includes(p)));
check('default: code-execution writes ask', ['~/.bashrc', '~/.pi/agent/extensions'].every((p) => (fs.askWrite ?? []).includes(p)));
check('default: allowWrite is project, /tmp and home', ['.', '/tmp', '~'].every((p) => (fs.allowWrite ?? []).includes(p)));
check('default: network allowlist is non-empty', Array.isArray(d?.network?.allowedDomains) && d.network.allowedDomains.length > 0);

const baseline = shippedPolicy();
check('baseline: denyRead comes from the file, not from code', JSON.stringify(baseline.filesystem.denyRead) === JSON.stringify(fs.denyRead));
check('baseline: allowedDomains comes from the file, not from code', JSON.stringify(baseline.network.allowedDomains) === JSON.stringify(d?.network?.allowedDomains));

const base = {
	enabled: true,
	network: { allowedDomains: ['a.com'], deniedDomains: ['x.com'] },
	filesystem: { denyRead: ['~/.ssh'], allowWrite: ['.'] },
	overrides: { allowRead: ['keep'] },
};
const top = {
	network: { allowedDomains: ['b.com'] },
	filesystem: { denyRead: ['~/.aws'] },
	overrides: { allowRead: ['add'], allowDomains: ['c.com'] },
};
const out = overlayPolicy(base, top);
check('overlay: present key replaces (array)', JSON.stringify(out.filesystem.denyRead) === '["~/.aws"]');
check('overlay: object merges shallowly (keeps other keys)', JSON.stringify(out.network.deniedDomains) === '["x.com"]');
check('overlay: absent key keeps base', JSON.stringify(out.filesystem.allowWrite) === '["."]' && out.enabled === true);
check('overlay: overrides concatenate', JSON.stringify(out.overrides.allowRead) === '["keep","add"]');
check('overlay: overrides gains new list', JSON.stringify(out.overrides.allowDomains) === '["c.com"]');
check('overlay: undefined is ignored', overlayPolicy(base, { enabled: undefined }).enabled === true);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
