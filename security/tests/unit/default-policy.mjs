// Shipped baseline (sandbox.default.json) + shared policy overlaying.
import { loadDefaultPolicy, overlayPolicy } from '../../../src/core/index.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

// --- the shipped default is present and strong ---
const d = loadDefaultPolicy();
check('sandbox.default.json is found', d !== null && typeof d === 'object');
const fs = d?.filesystem ?? {};
check('default: outsideProject.read = allow', fs.outsideProject?.read === 'allow');
check('default: nothing is hard-denied on read', (fs.denyRead ?? []).length === 0);
check('default: nothing is hard-denied on write', (fs.denyWrite ?? []).length === 0);
check('default: modelDenyRead is empty', (fs.modelDenyRead ?? []).length === 0);
check('default: credential filenames ask on read', ['id_rsa', '*.pem', '*.key'].every((p) => (fs.askRead ?? []).includes(p)));
check('default: agent secrets ask on read', ['auth.json', 'mcp.json', 'mcp-auth.json'].every((p) => (fs.askRead ?? []).includes(p)));
check('default: write asks cover .env and shell rc', (fs.askWrite ?? []).includes('.env') && (fs.askWrite ?? []).includes('~/.bashrc'));
check('default: allowWrite is project + /tmp', Array.isArray(fs.allowWrite) && fs.allowWrite.includes('.') && fs.allowWrite.includes('/tmp'));
check('default: network allowlist is non-empty', Array.isArray(d?.network?.allowedDomains) && d.network.allowedDomains.length > 0);

// --- overlayPolicy: authoritative layering ---
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
