// Layer 2 ask-tier decision contract (ADR-009 / ADR-010).
// Drives `askDecision` with a scripted `ctx.ui.select` — no pi, no fs, no audit.
import { ASK_TIMEOUT_MS } from '../../../src/ui/ask-flow.ts';
import { askDecision, denyMessage, displayWhy } from '../../../src/ui/ask.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const fileKind = { layer: 2, tool: 'read', subject: '/home/me/project/.env', reason: 'denyRead matched ".env" → /home/me/project/.env', overrideKind: 'allowRead', overrideValue: '/home/me/project/.env' };
const writeKind = { ...fileKind, tool: 'write', overrideKind: 'allowWrite' };
const domainKind = { layer: 2, tool: 'fetch_content', subject: 'https://example.com/a', reason: 'domain not in allowlist: example.com', overrideKind: 'allowDomains', overrideValue: 'example.com' };

/** A ctx that answers each `select` from a queue and records the option lists it was shown. */
const mkCtx = (answers) => {
	const seen = [];
	let i = 0;
	return {
		seen,
		ctx: { hasUI: true, ui: { select: async (_t, o) => { seen.push(o); const a = answers[i++]; return typeof a === 'function' ? a(o) : a; } } },
	};
};

// --- headless ---
let selectCalled = false;
const headless = { hasUI: false, ui: { select: async () => { selectCalled = true; return undefined; } } };
check('headless returns no without prompting', (await askDecision(headless, fileKind, null)) === 'no' && !selectCalled);

// --- screen 1 mapping: Block / Allow once / Allow for this session / Allow and remember… ---
check('screen1 Block → no', (await askDecision(mkCtx([(o) => o[0]]).ctx, fileKind, null)) === 'no');
check('screen1 timeout/undefined → no', (await askDecision(mkCtx([undefined]).ctx, fileKind, null)) === 'no');
check('screen1 Allow once → yes', (await askDecision(mkCtx([(o) => o[1]]).ctx, fileKind, null)) === 'yes');
check('screen1 Allow for this session → session', (await askDecision(mkCtx([(o) => o[2]]).ctx, fileKind, null)) === 'session');

// --- screen 2 mapping (file kind) ---
const remember = (idx) => [(o) => o[3], (o) => o[idx]];
check('remember: file · this project → always-cwd', (await askDecision(mkCtx(remember(0)).ctx, fileKind, null)) === 'always-cwd');
check('remember: folder · this project → always-cwd-folder', (await askDecision(mkCtx(remember(1)).ctx, fileKind, null)) === 'always-cwd-folder');
check('remember: file · all projects → always-global', (await askDecision(mkCtx(remember(2)).ctx, fileKind, null)) === 'always-global');
check('remember: folder · all projects → always-global-folder', (await askDecision(mkCtx(remember(3)).ctx, fileKind, null)) === 'always-global-folder');
check('screen2 esc/timeout → no', (await askDecision(mkCtx([(o) => o[3], undefined]).ctx, fileKind, null)) === 'no');

// --- exact screen-2 labels (the finalized format) ---
const labelCtx = mkCtx([(o) => o[3], undefined]);
await askDecision(labelCtx.ctx, fileKind, null);
const fileOpts = labelCtx.seen[1];
check('label: Allow for this file (<path>) - Scope this project', fileOpts[0] === 'Allow for this file (/home/me/project/.env) - Scope this project');
check('label: Allow for this folder (<path>) - Scope global', fileOpts[3] === 'Allow for this folder (/home/me/project) - Scope global');

// --- write kind shares the flow ---
check('write: remember folder · all projects', (await askDecision(mkCtx([(o) => o[3], (o) => o[3]]).ctx, writeKind, null)) === 'always-global-folder');

// --- domain kind: no folder option ---
check('domain remember: this project → always-cwd', (await askDecision(mkCtx([(o) => o[3], (o) => o[0]]).ctx, domainKind, null)) === 'always-cwd');
check('domain remember: all projects → always-global', (await askDecision(mkCtx([(o) => o[3], (o) => o[1]]).ctx, domainKind, null)) === 'always-global');
const domainCtx = mkCtx([(o) => o[3], undefined]);
await askDecision(domainCtx.ctx, domainKind, null);
check('domain screen2 has no folder option', domainCtx.seen[1].every((o) => !o.includes('folder')));
check('domain label: Allow for this host (example.com) - Scope this project', domainCtx.seen[1][0] === 'Allow for this host (example.com) - Scope this project');

// --- domain screen 1: Allow first, and the countdown default is Allow (ADR-024) ---
const domainMain = mkCtx([(o) => o[0]]);
check('domain screen1 Allow (default) → yes', (await askDecision(domainMain.ctx, domainKind, null)) === 'yes');
check(
	'domain screen1 order = Allow (default) / Deny / session / remember',
	domainMain.seen[0].join('|') === 'Allow (default)|Deny|Allow for this session|Allow and remember…',
);
check('domain screen1 Deny → no', (await askDecision(mkCtx([(o) => o[1]]).ctx, domainKind, null)) === 'no');
check('domain screen1 Allow for this session → session', (await askDecision(mkCtx([(o) => o[2]]).ctx, domainKind, null)) === 'session');
{
	const realNow = Date.now;
	let clock = realNow();
	Date.now = () => clock;
	const expire = () => {
		clock = realNow() + ASK_TIMEOUT_MS + 1;
		return undefined;
	};
	check('domain screen1 countdown expiry → yes', (await askDecision(mkCtx([expire]).ctx, domainKind, null)) === 'yes');
	check('file screen1 countdown expiry → no', (await askDecision(mkCtx([expire]).ctx, fileKind, null)) === 'no');
	Date.now = realNow;
}

// --- absolute-deny: two deliberate steps, no "remember" ---
check('absolute-deny: allow both steps → yes', (await askDecision(mkCtx([(o) => o[1], (o) => o[1]]).ctx, fileKind, '~/.ssh')) === 'yes');
check('absolute-deny: step1 block → no', (await askDecision(mkCtx([(o) => o[0]]).ctx, fileKind, '~/.ssh')) === 'no');
check('absolute-deny: step2 block → no', (await askDecision(mkCtx([(o) => o[1], (o) => o[0]]).ctx, fileKind, '~/.ssh')) === 'no');

// --- displayWhy strips the arrow path ---
check('displayWhy strips " → path"', displayWhy('denyRead matched ".env" → /x/.env') === 'denyRead matched ".env"');

// --- one denial pattern for every L2 block ---
check('denyMessage: read', denyMessage('allowRead', 'denyRead matched ".env" → /x/.env') === 'Read blocked by policy: denyRead matched ".env". Nothing was read — ask the user.');
check('denyMessage: write', denyMessage('allowWrite', 'not under any allowWrite root → /x') === 'Write blocked by policy: not under any allowWrite root. Nothing was written — ask the user.');
check('denyMessage: network', denyMessage('allowDomains', 'domain not in allowlist: x.com') === 'Network blocked by policy: not in the allowlist. Nothing was fetched — ask the user.');

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
