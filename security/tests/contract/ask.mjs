// Layer 2 ask-tier decision contract (ADR-009 / ADR-010 / ADR-015).
// Drives `askDecision` with a scripted `ctx.ui.select` — no pi, no fs, no audit.
import { askDecision } from '../../../src/l2-guard/ask.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const fileKind = { layer: 2, tool: 'read', subject: '/home/me/.ssh/id_rsa', reason: 'denyRead matched "~/.ssh"', overrideKind: 'allowRead', overrideValue: '/home/me/.ssh/id_rsa' };
const domainKind = { layer: 2, tool: 'fetch_content', subject: 'https://x.example/a', reason: 'domain not in allowlist', overrideKind: 'allowDomains', overrideValue: 'x.example' };

/** A ctx whose select returns a scripted value or the result of a picker. */
const scripted = (pick) => ({ hasUI: true, ui: { select: async (_t, options) => (typeof pick === 'function' ? pick(options) : pick) } });

// --- headless ---
let selectCalled = false;
const headless = { hasUI: false, ui: { select: async () => { selectCalled = true; return undefined; } } };
check('headless returns no without prompting', (await askDecision(headless, fileKind, null)) === 'no' && !selectCalled);

// --- normal tier: the "no" option is first and pre-selected ---
check('first option (no) → no', (await askDecision(scripted((o) => o[0]), fileKind, null)) === 'no');
check('timeout/undefined → no', (await askDecision(scripted(undefined), fileKind, null)) === 'no');
check('"yes — this once" → yes', (await askDecision(scripted((o) => o[1]), fileKind, null)) === 'yes');
check('session (file) → session', (await askDecision(scripted((o) => o.find((x) => x.startsWith('yes — for this session'))), fileKind, null)) === 'session');
check('session (folder) → session-folder', (await askDecision(scripted((o) => o.find((x) => x.startsWith('yes — for this session') && x.includes('parent folder'))), fileKind, null)) === 'session-folder');
check('always cwd file → always-cwd', (await askDecision(scripted((o) => o.find((x) => x.startsWith('always for CURRENT project') && !x.includes('parent folder'))), fileKind, null)) === 'always-cwd');
check('always cwd folder → always-cwd-folder', (await askDecision(scripted((o) => o.find((x) => x.startsWith('always for CURRENT project') && x.includes('parent folder'))), fileKind, null)) === 'always-cwd-folder');
check('always global file → always-global', (await askDecision(scripted((o) => o.find((x) => x.startsWith('always for ALL projects') && !x.includes('parent folder'))), fileKind, null)) === 'always-global');
check('always global folder → always-global-folder', (await askDecision(scripted((o) => o.find((x) => x.startsWith('always for ALL projects') && x.includes('parent folder'))), fileKind, null)) === 'always-global-folder');

// --- domain kind: no folder options, and the this-once option exists ---
let domainOptions;
await askDecision({ hasUI: true, ui: { select: async (_t, o) => { domainOptions = o; return undefined; } } }, domainKind, null);
check('domain options offer this-once', domainOptions.includes('yes — this once'));
check('domain options have no folder grant', domainOptions.every((o) => !o.includes('parent folder')));

// --- absolute-deny tier: two deliberate steps ---
const twoStep = (answers) => { let i = 0; return { hasUI: true, ui: { select: async () => answers[i++] } }; };
check('abs-deny step1 block → no', (await askDecision(twoStep(['no  — block (default)']), fileKind, '~/.ssh')) === 'no');
check('abs-deny step1 allow, step2 no → no', (await askDecision(twoStep(['allow this ONE call', 'No  — keep it blocked (default)']), fileKind, '~/.ssh')) === 'no');
check('abs-deny step1 allow, step2 yes → yes', (await askDecision(twoStep(['allow this ONE call', 'Yes — allow this ONE call']), fileKind, '~/.ssh')) === 'yes');

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
