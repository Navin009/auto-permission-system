// Shared ask-flow contract (src/ui/ask-flow.ts) — the reusable two-screen UI.
// Drives each helper with a scripted ctx.ui.select; no pi, no fs.
import { askMain, askRememberFile, askRememberHost, askExposure, withheldNotice, ASK_TIMEOUT_MS, ICON } from '../../../src/ui/ask-flow.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

/** Run fn with a ctx whose select records the option list and returns undefined. */
const optionsOf = async (fn) => {
	let seen;
	const ctx = { hasUI: true, ui: { select: async (_t, o) => { seen = o; return undefined; } } };
	await fn(ctx);
	return seen;
};

// --- askMain: option set (v3.3 UX revamp) ---
const base = await optionsOf((ctx) => askMain(ctx, 'H', '  body'));
check(
	'askMain base = No / Yes, just this once / remember',
	base.join('|') === 'No|Yes, just this once|Yes, always\u2026',
);
const withSession = await optionsOf((ctx) => askMain(ctx, 'H', 'b', { session: true }));
check(
	'askMain session inserts before remember',
	withSession.join('|') === 'No|Yes, just this once|Yes, for this session|Yes, always\u2026',
);
const noOnce = await optionsOf((ctx) => askMain(ctx, 'H', 'b', { once: false }));
check(
	'askMain once:false omits Yes, just this once',
	!noOnce.includes('Yes, just this once') && noOnce[0] === 'No',
);
const noRemember = await optionsOf((ctx) => askMain(ctx, 'H', 'b', { remember: false }));
check(
	'askMain remember:false omits Yes, always\u2026',
	!noRemember.includes('Yes, always\u2026'),
);

// --- askMain: order with footer ---
const withSessionTitle = await optionsOf((ctx) => askMain(ctx, 'H', 'b', { session: true }));
check(
	'askMain: title has header + body + footer',
	withSessionTitle[0] === 'No' && withSessionTitle[2] === 'Yes, for this session' && withSessionTitle[3] === 'Yes, always\u2026',
);

// --- askMain: allow-first ordering (network asks, ADR-024) — same option order, Enter picks Yes (once) ---
const allowFirstOpts = await optionsOf((ctx) => askMain(ctx, 'H', 'b', { session: true, allowFirst: true }));
check(
	'askMain allowFirst = No / Yes, just this once / session / remember',
	allowFirstOpts.join('|') === 'No|Yes, just this once|Yes, for this session|Yes, always\u2026',
);
const pickAllowFirst = async (pick) =>
	askMain({ hasUI: true, ui: { select: async (_t, o) => (typeof pick === 'function' ? pick(o) : pick) } }, 'H', 'b', { session: true, allowFirst: true });
check('askMain allowFirst o0 → block', (await pickAllowFirst((o) => o[0])) === 'block');
check('askMain allowFirst o1 → once', (await pickAllowFirst((o) => o[1])) === 'once');
check('askMain allowFirst o2 → session', (await pickAllowFirst((o) => o[2])) === 'session');
check('askMain allowFirst o3 → remember', (await pickAllowFirst((o) => o[3])) === 'remember');
check('askMain allowFirst undefined (Esc) → block', (await pickAllowFirst(undefined)) === 'block');

// --- askMain: countdown expiry is the default; Esc is not ---
const expires = { hasUI: true, ui: { select: async () => { await new Promise((r) => setTimeout(r, 30)); return undefined; } } };
check('askMain allowFirst countdown expiry → once', (await askMain(expires, 'H', 'b', { allowFirst: true, timeoutMs: 10 })) === 'once');
check('askMain countdown expiry stays block for file asks', (await askMain(expires, 'H', 'b', { timeoutMs: 10 })) === 'block');

// --- prompts are serialized: pi's selector is a singleton (ADR-024) ---
let active = 0;
let maxActive = 0;
const starts = [];
const serialized = {
	hasUI: true,
	ui: {
		select: async (_t, o) => {
			active++;
			maxActive = Math.max(maxActive, active);
			starts.push(o[0]);
			await new Promise((r) => setTimeout(r, 15));
			active--;
			return undefined;
		},
	},
};
await Promise.all([askMain(serialized, 'A', 'b'), askMain(serialized, 'B', 'b')]);
check('askMain serializes overlapping prompts in FIFO order', maxActive === 1 && starts.join('|') === 'No|No');

// --- askMain: mapping ---
const pickMain = async (pick) => askMain({ hasUI: true, ui: { select: async (_t, o) => (typeof pick === 'function' ? pick(o) : pick) } }, 'H', 'b', { session: true });
check('askMain o0 → block', (await pickMain((o) => o[0])) === 'block');
check('askMain o1 → once', (await pickMain((o) => o[1])) === 'once');
check('askMain o2 → session', (await pickMain((o) => o[2])) === 'session');
check('askMain o3 → remember', (await pickMain((o) => o[3])) === 'remember');
check('askMain undefined → block', (await askMain({ hasUI: true, ui: { select: async () => undefined } }, 'H', 'b')) === 'block');

// --- askRememberFile (v3.3 labels) ---
const fileOpts = await optionsOf((ctx) => askRememberFile(ctx, 'T', 'b', '/f/x', '/f'));
check('askRememberFile: 4 options with folder', fileOpts.length === 4);
check(
	'askRememberFile: folder first, (recommended) marker',
	fileOpts[0] === 'All in folder   in this project   (recommended)' && fileOpts[0].endsWith('(recommended)'),
);
check(
	'askRememberFile: file-then-folder pattern across scopes',
	fileOpts[2] === 'All in folder   in all projects' && fileOpts[3] === 'Only x   in all projects',
);
const fileNoFolder = await optionsOf((ctx) => askRememberFile(ctx, 'T', 'b', '/f/x', null));
check(
	'askRememberFile: 2 options without folder (file only, both)',
	fileNoFolder.length === 2 && fileNoFolder[0] === 'Only x   in this project' && fileNoFolder[1] === 'Only x   in all projects',
);
const pickFile = async (idx) => askRememberFile({ hasUI: true, ui: { select: async (_t, o) => o[idx] } }, 'T', 'b', '/f/x', '/f');
check('remember folder · project', JSON.stringify(await pickFile(0)) === '{"scope":"cwd","folder":true}');
check('remember file · project', JSON.stringify(await pickFile(1)) === '{"scope":"cwd","folder":false}');
check('remember folder · global', JSON.stringify(await pickFile(2)) === '{"scope":"global","folder":true}');
check('remember file · global', JSON.stringify(await pickFile(3)) === '{"scope":"global","folder":false}');
check('askRememberFile undefined → null', (await askRememberFile({ hasUI: true, ui: { select: async () => undefined } }, 'T', 'b', '/f/x', '/f')) === null);
// --- askRememberFile: untrusted hides cwd rows ---
const untrustedOpts = await optionsOf((ctx) => askRememberFile(ctx, 'T', 'b', '/f/x', '/f', { untrusted: true }));
check(
	'askRememberFile untrusted: 2 options, both global',
	untrustedOpts.length === 2 && untrustedOpts.every((o) => o.includes('in all projects')),
);

// --- askRememberHost (v3.3 labels) ---
const hostOpts = await optionsOf((ctx) => askRememberHost(ctx, 'T', 'b', 'example.com'));
check(
	'askRememberHost: 2 options for apex',
	hostOpts.length === 2 && hostOpts[0].includes('in this project') && hostOpts[1].includes('in all projects'),
);
const pickHost = async (idx) => askRememberHost({ hasUI: true, ui: { select: async (_t, o) => o[idx] } }, 'T', 'b', 'example.com');
check('remember host · project', (await pickHost(0)).scope === 'cwd' && (await pickHost(0)).pattern === 'example.com');
check('remember host · global', (await pickHost(1)).scope === 'global' && (await pickHost(1)).pattern === 'example.com');
const subdomainOpts = await optionsOf((ctx) => askRememberHost(ctx, 'T', 'b', 'api.example.com'));
check(
	'askRememberHost: 4 options for subdomain, wildcard first',
	subdomainOpts.length === 4 && subdomainOpts[0].includes('All in group') && subdomainOpts[0].includes('(*.example.com)') && subdomainOpts[0].includes('(recommended)'),
);
check(
	'askRememberHost: wildcard-then-exact pattern across scopes',
	subdomainOpts[2].includes('All in group') && subdomainOpts[2].includes('in all projects') && subdomainOpts[3] === 'Only api.example.com   in all projects',
);
const pickSubdomain = async (idx) => askRememberHost({ hasUI: true, ui: { select: async (_t, o) => o[idx] } }, 'T', 'b', 'api.example.com');
check('remember wildcard · project', (await pickSubdomain(0)).scope === 'cwd' && (await pickSubdomain(0)).pattern === '*.example.com');
check('remember exact host · project', (await pickSubdomain(1)).scope === 'cwd' && (await pickSubdomain(1)).pattern === 'api.example.com');
// --- askRememberHost: untrusted hides cwd rows ---
const untrustedHostOpts = await optionsOf((ctx) => askRememberHost(ctx, 'T', 'b', 'api.example.com', { untrusted: true }));
check(
	'askRememberHost untrusted: 2 options, both global',
	untrustedHostOpts.length === 2 && untrustedHostOpts.every((o) => o.includes('in all projects')),
);

// --- askExposure (Advanced Secure output gate, ADR-018) ---
const hit = 'config.env\n12: key=asdfadsdaasdfdsafasdf';
const expOpts = await optionsOf((ctx) => askExposure(ctx, [hit]));
check('askExposure: 2 options, keep-hidden first', expOpts.length === 2 && expOpts[0].startsWith('No, keep it hidden'));
check('askExposure: allow label', expOpts[1].startsWith('Yes, show it this once'));
let expTitle;
await askExposure({ hasUI: true, ui: { select: async (t) => { expTitle = t; return undefined; } } }, [hit]);
check(
	'askExposure: icon-prefixed title + location + line + footer',
	expTitle.startsWith(`${ICON.cred}  This output may contain a secret`) && expTitle.includes('config.env') && expTitle.includes('12: key=asdfadsdaasdfdsafasdf') && expTitle.includes('Esc or no answer in 10s = No'),
);
const multiHit = 'config.env\n12: key=aaa\n20: OPENAI_API_KEY=sk-bbb';
let multiTitle;
await askExposure({ hasUI: true, ui: { select: async (t) => { multiTitle = t; return undefined; } } }, [multiHit]);
check('askExposure: multiple lines listed', multiTitle.includes('12: key=aaa') && multiTitle.includes('20: OPENAI_API_KEY=sk-bbb'));
check('askExposure undefined → block', (await askExposure({ hasUI: true, ui: { select: async () => undefined } }, [hit])) === 'block');
check('askExposure pick allow → allow', (await askExposure({ hasUI: true, ui: { select: async (_t, o) => o[1] } }, [hit])) === 'allow');
check('askExposure pick block → block', (await askExposure({ hasUI: true, ui: { select: async (_t, o) => o[0] } }, [hit])) === 'block');

// --- askExposure with programId: adds "Yes, all <program> output for this session" ---
const expOptsWithProg = await optionsOf((ctx) => askExposure(ctx, [hit], 'composio'));
check(
	'askExposure +programId: 3 options, session-grant row added',
	expOptsWithProg.length === 3 && expOptsWithProg[2] === 'Yes, all composio output for this session',
);
const pickProgramSession = async (idx) => askExposure({ hasUI: true, ui: { select: async (_t, o) => o[idx] } }, [hit], 'composio');
check('askExposure +programId o0 → block', (await pickProgramSession(0)) === 'block');
check('askExposure +programId o1 → allow', (await pickProgramSession(1)) === 'allow');
check('askExposure +programId o2 → program-session', (await pickProgramSession(2)) === 'program-session');
check(
	'askExposure +programId undefined → block',
	(await askExposure({ hasUI: true, ui: { select: async () => undefined } }, [hit], 'aws')) === 'block',
);

const notice = withheldNotice('config.env');
check('withheldNotice: names the subject', notice.includes('config.env') && notice.includes('withheld'));
check('withheldNotice: says the tool completed', notice.includes('completed successfully') && notice.includes('output is unavailable'));
check('ask timeout defaults to 10s', ASK_TIMEOUT_MS === 10_000);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);