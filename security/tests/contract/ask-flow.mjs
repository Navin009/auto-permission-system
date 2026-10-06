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
const hit = 'config.env:12\n   above line\n > key=asdfadsdaasdfdsafasdf\n   below line';
const expOpts = await optionsOf((ctx) => askExposure(ctx, [hit]));
check('askExposure: 2 options, keep-private first', expOpts.length === 2 && expOpts[0].startsWith('No, keep private'));
check('askExposure: allow label', expOpts[1].startsWith('Yes, allow'));
let expTitle;
await askExposure({ hasUI: true, ui: { select: async (t) => { expTitle = t; return undefined; } } }, [hit]);
check('askExposure: header + location + line + question', expTitle.startsWith('⚠ Private content found') && expTitle.includes('config.env:12') && expTitle.includes('key=asdfadsdaasdfdsafasdf') && expTitle.includes('Should the AI be allowed to see it?'));
check('askExposure: no finding-type label', !expTitle.includes('SECRET_ASSIGNMENT'));
check('askExposure undefined → block', (await askExposure({ hasUI: true, ui: { select: async () => undefined } }, [hit])) === 'block');
check('askExposure pick allow → allow', (await askExposure({ hasUI: true, ui: { select: async (_t, o) => o[1] } }, [hit])) === 'allow');
check('askExposure pick block → block', (await askExposure({ hasUI: true, ui: { select: async (_t, o) => o[0] } }, [hit])) === 'block');

const notice = withheldNotice('config.env');
check('withheldNotice: names the subject', notice.includes('config.env') && notice.includes('withheld'));
check('withheldNotice: says the tool completed', notice.includes('completed successfully') && notice.includes('output is unavailable'));
check('ask timeout defaults to 10s', ASK_TIMEOUT_MS === 10_000);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
