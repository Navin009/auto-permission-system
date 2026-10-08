// Layer 2 ask-tier decision contract (ADR-009 / ADR-010 / ADR-030).
// Drives `askDecision` with a scripted `ctx.ui.select` — no pi, no fs, no audit.
import { ASK_TIMEOUT_MS } from '../../../src/ui/ask-flow.ts';
import { askDecision, denyMessage, displayWhy } from '../../../src/ui/ask.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const fileKind = { layer: 2, tool: 'read', subject: '/home/me/project/.env', reason: 'denyRead matched ".env" → /home/me/project/.env', overrideKind: 'allowRead', overrideValue: '/home/me/project/.env', command: 'grep -r TOKEN .env', projectTrusted: true };
const writeKind = { ...fileKind, tool: 'write', overrideKind: 'allowWrite' };
const domainKind = { layer: 2, tool: 'fetch_content', subject: 'https://example.com/a', reason: 'domain not in allowlist: example.com', overrideKind: 'allowDomains', overrideValue: 'example.com', command: 'curl https://example.com/api', projectTrusted: true };

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

// --- screen 1 mapping: No / Yes, just this once / Yes, for this session / Yes, always… ---
check('screen1 No → no', (await askDecision(mkCtx([(o) => o[0]]).ctx, fileKind, null)) === 'no');
check('screen1 timeout/undefined → no', (await askDecision(mkCtx([undefined]).ctx, fileKind, null)) === 'no');
check('screen1 Yes, just this once → yes', (await askDecision(mkCtx([(o) => o[1]]).ctx, fileKind, null)) === 'yes');
check('screen1 Yes, for this session → session', (await askDecision(mkCtx([(o) => o[2]]).ctx, fileKind, null)) === 'session');

// --- screen 2 mapping (file kind) — ADR-030: folder-cwd, file-cwd, folder-global, file-global ---
const remember = (idx) => [(o) => o[3], (o) => o[idx]];
check('remember: folder · this project → always-cwd-folder', (await askDecision(mkCtx(remember(0)).ctx, fileKind, null)) === 'always-cwd-folder');
check('remember: file · this project → always-cwd', (await askDecision(mkCtx(remember(1)).ctx, fileKind, null)) === 'always-cwd');
check('remember: folder · all projects → always-global-folder', (await askDecision(mkCtx(remember(2)).ctx, fileKind, null)) === 'always-global-folder');
check('remember: file · all projects → always-global', (await askDecision(mkCtx(remember(3)).ctx, fileKind, null)) === 'always-global');
check('screen2 esc/timeout → no', (await askDecision(mkCtx([(o) => o[3], undefined]).ctx, fileKind, null)) === 'no');

// --- exact screen-2 labels (the finalized v3.3 format) ---
const labelCtx = mkCtx([(o) => o[3], undefined]);
await askDecision(labelCtx.ctx, fileKind, null);
const fileOpts = labelCtx.seen[1];
check('label: All in folder in this project (recommended)', fileOpts[0] === 'All in folder   in this project   (recommended)');
check('label: Only x in all projects', fileOpts[3] === 'Only .env   in all projects');

// --- write kind shares the flow ---
check('write: remember folder · all projects', (await askDecision(mkCtx([(o) => o[3], (o) => o[2]]).ctx, writeKind, null)) === 'always-global-folder');

// --- domain kind: no folder option, but wildcard subdomain is offered first when useful ---
check('domain remember: this project → always-cwd', (await askDecision(mkCtx([(o) => o[3], (o) => o[0]]).ctx, domainKind, null)) === 'always-cwd');
check('domain remember: all projects → always-global', (await askDecision(mkCtx([(o) => o[3], (o) => o[1]]).ctx, domainKind, null)) === 'always-global');
const domainCtx = mkCtx([(o) => o[3], undefined]);
await askDecision(domainCtx.ctx, domainKind, null);
check('domain screen2 has no folder option', domainCtx.seen[1].every((o) => !o.includes('folder')));
// "All in group" only appears for 3+ part hosts (a useful parent-domain wildcard).
const subdomainKind = { ...domainKind, overrideValue: 'api.example.com', subject: 'https://api.example.com/v1' };
const subdomainCtx = mkCtx([(o) => o[3], undefined]);
await askDecision(subdomainCtx.ctx, subdomainKind, null);
check(
	'subdomain screen2 first row = All in group (*.example.com) ... (recommended)',
	subdomainCtx.seen[1][0] === 'All in group   (*.example.com)   in this project   (recommended)',
);
// Domain screen 1 — option order is now No / Yes (just this once) / session / remember,
// regardless of allowFirst. The Enter preselect is "Yes, just this once" because of
// allowFirst (ADR-024); the explicit default of "No" is still the visible first row.
const domainMain = mkCtx([(o) => o[1]]);
check('domain screen1 Yes, just this once → yes', (await askDecision(domainMain.ctx, domainKind, null)) === 'yes');
check(
	'domain screen1 order = No / Yes, just this once / session / remember',
	domainMain.seen[0].join('|') === 'No|Yes, just this once|Yes, all in group for this session|Yes, always\u2026',
);
check('domain screen1 No → no', (await askDecision(mkCtx([(o) => o[0]]).ctx, domainKind, null)) === 'no');
check('domain screen1 Yes, all in group for this session → session', (await askDecision(mkCtx([(o) => o[2]]).ctx, domainKind, null)) === 'session');
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

// --- absolute-deny: ONE screen (v3.3 collapse of ADR-009's two-step). No (recommended)
// is preselected on Enter; the Risk line in the body is what makes the default safe. ---
check('absolute-deny: Yes, allow this one read → yes', (await askDecision(mkCtx([(o) => o[1]]).ctx, fileKind, '~/.ssh')) === 'yes');
check('absolute-deny: No → no', (await askDecision(mkCtx([(o) => o[0]]).ctx, fileKind, '~/.ssh')) === 'no');
check('absolute-deny: timeout/Esc → no', (await askDecision(mkCtx([undefined]).ctx, fileKind, '~/.ssh')) === 'no');
// Only one select call, no second "are you sure?" screen.
const absCtx = mkCtx([(o) => o[1]]);
await askDecision(absCtx.ctx, fileKind, '~/.ssh');
check('absolute-deny: one screen, no second prompt', absCtx.seen.length === 1);

// --- displayWhy strips the arrow path ---
check('displayWhy strips " → path"', displayWhy('denyRead matched ".env" → /x/.env') === 'denyRead matched ".env"');

// --- one denial pattern for every L2 block ---
check('denyMessage: read', denyMessage('allowRead', 'denyRead matched ".env" → /x/.env') === 'Read blocked by policy: denyRead matched ".env". Nothing was read \u2014 ask the user.');
check('denyMessage: write', denyMessage('allowWrite', 'not under any allowWrite root → /x') === 'Write blocked by policy: not under any allowWrite root. Nothing was written \u2014 ask the user.');
check(
	'denyMessage: network',
	denyMessage('allowDomains', 'domain not in allowlist: x.com') === 'Network blocked by policy: this site isn\'t on your allowed list yet. Nothing was fetched \u2014 ask the user.',
);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);