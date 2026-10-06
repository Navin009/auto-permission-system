// Shared ask-flow contract (src/ui/ask-flow.ts) — the reusable two-screen UI.
// Drives each helper with a scripted ctx.ui.select; no pi, no fs.
import { askMain, askRememberFile, askRememberHost, askExposure, withheldNotice, ASK_TIMEOUT_MS } from '../../../src/ui/ask-flow.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

/** Run fn with a ctx whose select records the option list and returns undefined. */
const optionsOf = async (fn) => {
	let seen;
	const ctx = { hasUI: true, ui: { select: async (_t, o) => { seen = o; return undefined; } } };
	await fn(ctx);
	return seen;
};

// --- askMain: option set ---
const base = await optionsOf((ctx) => askMain(ctx, 'H', '  body'));
check('askMain base = Block / once / remember', base.join('|') === 'Block (default)|Allow once|Allow and remember…');
const withSession = await optionsOf((ctx) => askMain(ctx, 'H', 'b', { session: true }));
check('askMain session inserts before remember', withSession[2] === 'Allow for this session' && withSession[3] === 'Allow and remember…');
const noOnce = await optionsOf((ctx) => askMain(ctx, 'H', 'b', { once: false }));
check('askMain once:false omits Allow once', !noOnce.includes('Allow once') && noOnce[0] === 'Block (default)');
const noRemember = await optionsOf((ctx) => askMain(ctx, 'H', 'b', { remember: false }));
check('askMain remember:false omits remember', !noRemember.includes('Allow and remember…'));

// --- askMain: mapping ---
const pickMain = async (pick) => askMain({ hasUI: true, ui: { select: async (_t, o) => (typeof pick === 'function' ? pick(o) : pick) } }, 'H', 'b', { session: true });
check('askMain Block → block', (await pickMain((o) => o[0])) === 'block');
check('askMain once → once', (await pickMain((o) => o[1])) === 'once');
check('askMain session → session', (await pickMain((o) => o[2])) === 'session');
check('askMain remember → remember', (await pickMain((o) => o[3])) === 'remember');
check('askMain undefined → block', (await askMain({ hasUI: true, ui: { select: async () => undefined } }, 'H', 'b')) === 'block');

// --- askRememberFile ---
const fileOpts = await optionsOf((ctx) => askRememberFile(ctx, 'T', 'b', '/f/x', '/f'));
check('askRememberFile: 4 options with folder', fileOpts.length === 4);
check('askRememberFile: labels', fileOpts[0] === 'Allow for this file (/f/x) - Scope this project' && fileOpts[3] === 'Allow for this folder (/f) - Scope global');
const fileNoFolder = await optionsOf((ctx) => askRememberFile(ctx, 'T', 'b', '/f/x', null));
check('askRememberFile: 2 options without folder', fileNoFolder.length === 2 && fileNoFolder.every((o) => !o.includes('folder')));
const pickFile = async (idx) => askRememberFile({ hasUI: true, ui: { select: async (_t, o) => o[idx] } }, 'T', 'b', '/f/x', '/f');
check('remember file · project', JSON.stringify(await pickFile(0)) === '{"scope":"cwd","folder":false}');
check('remember folder · project', JSON.stringify(await pickFile(1)) === '{"scope":"cwd","folder":true}');
check('remember file · global', JSON.stringify(await pickFile(2)) === '{"scope":"global","folder":false}');
check('remember folder · global', JSON.stringify(await pickFile(3)) === '{"scope":"global","folder":true}');
check('askRememberFile undefined → null', (await askRememberFile({ hasUI: true, ui: { select: async () => undefined } }, 'T', 'b', '/f/x', '/f')) === null);

// --- askRememberHost ---
const hostOpts = await optionsOf((ctx) => askRememberHost(ctx, 'T', 'b', 'example.com'));
check('askRememberHost: 2 options', hostOpts.length === 2 && hostOpts[0].includes('Scope this project') && hostOpts[1].includes('Scope global'));
const pickHost = async (idx) => askRememberHost({ hasUI: true, ui: { select: async (_t, o) => o[idx] } }, 'T', 'b', 'example.com');
check('remember host · project', (await pickHost(0)).scope === 'cwd');
check('remember host · global', (await pickHost(1)).scope === 'global');

// --- askExposure (Advanced Secure output gate, ADR-018) ---
const expOpts = await optionsOf((ctx) => askExposure(ctx, 'bash', ['AWS_ACCESS_KEY']));
check('askExposure: 2 options, Block first', expOpts.length === 2 && expOpts[0].startsWith('Block (default)'));
check('askExposure: Allow send label', expOpts[1].startsWith('Allow send'));
check('askExposure undefined → block', (await askExposure({ hasUI: true, ui: { select: async () => undefined } }, 'bash', ['JWT'])) === 'block');
check('askExposure pick allow → allow', (await askExposure({ hasUI: true, ui: { select: async (_t, o) => o[1] } }, 'bash', ['JWT'])) === 'allow');
check('askExposure pick block → block', (await askExposure({ hasUI: true, ui: { select: async (_t, o) => o[0] } }, 'bash', ['JWT'])) === 'block');

const notice = withheldNotice('bash', ['JWT', 'AWS_ACCESS_KEY']);
check('withheldNotice: names the tool and findings', notice.includes('bash') && notice.includes('JWT') && notice.includes('AWS_ACCESS_KEY'));
check('withheldNotice: explicit not-a-failure', notice.includes('not a tool failure') && notice.includes('not an empty result'));
check('ask timeout defaults to 10s', ASK_TIMEOUT_MS === 10_000);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
