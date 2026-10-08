// Layer 1 network ask (ADR-023 / ADR-030): the sandbox-runtime proxy callback routes
// unknown hosts through the shared ask-tier (once / session / remember),
// single-flights overlapping connections, and scopes "once" to one command.
// Pure: drives createNetworkAsk with a scripted ctx.ui.select and stub deps.
import { beginNetworkCommand, clearNetworkSessionGrants, createNetworkAsk, endNetworkCommand } from '../../../src/l1-sandbox/network-ask.ts';
import { ASK_TIMEOUT_MS } from '../../../src/ui/ask-flow.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

/** A ctx whose select answers from a queue and records the option lists and titles it was shown. */
function mkCtx(answers) {
	const seen = [];
	const seenTitles = [];
	const notified = [];
	let i = 0;
	return {
		seen,
		seenTitles,
		notified,
		ctx: {
			hasUI: true,
			ui: {
				select: async (t, o) => {
					seenTitles.push(t);
					seen.push(o);
					const a = answers[i++];
					return typeof a === 'function' ? a(o) : a;
				},
				notify: (m) => notified.push(m),
			},
		},
	};
}

function mkDeps(ctx, opts = {}) {
	const audits = [];
	const persisted = [];
	const live = [];
	return {
		audits,
		persisted,
		live,
		deps: {
			cwd: '/work',
			getCtx: () => ctx,
			persist: async (host, scope) => {
				if (opts.persistThrows) throw new Error('project file is not trusted');
				persisted.push([host, scope]);
				return '/work/.pi/sandbox.json';
			},
			applyLive: (h) => live.push(h),
			audit: (e) => audits.push(e),
			projectTrusted: opts.projectTrusted,
			command: opts.command,
		},
	};
}

// Module state is shared across asker instances; reset it between cases.
function reset() { endNetworkCommand(); clearNetworkSessionGrants(); }

// --- headless / no ctx ---
{
	reset();
	let called = false;
	const { deps, audits } = mkDeps({ hasUI: false, ui: { select: async () => { called = true; return undefined; } } });
	check('headless denies without prompting', (await createNetworkAsk(deps)({ host: 'example.com', port: 443 })) === false && !called);
	check('headless refusal audited', audits.some((e) => e.decision === 'no' && e.note === 'network-ask-headless'));
}
{
	reset();
	const { deps } = mkDeps(undefined);
	check('no ctx denies', (await createNetworkAsk(deps)({ host: 'example.com' })) === false);
}

// --- screen 1: No is the first option, Yes (just this once) is preselected (ADR-024) ---
{
	reset();
	const c = mkCtx([(o) => o[0]]);
	const { deps, audits } = mkDeps(c.ctx);
	check('No → block', (await createNetworkAsk(deps)({ host: 'example.com', port: 443 })) === false);
	check('No audited', audits.some((a) => a.decision === 'no' && a.layer === 1 && a.tool === 'network'));
}
{
	reset();
	const c = mkCtx([(o) => o[1]]);
	const { deps } = mkDeps(c.ctx);
	check('Yes, just this once → allow', (await createNetworkAsk(deps)({ host: 'example.com', port: 443 })) === true);
	check(
		'order = No / Yes, just this once / session / remember',
		c.seen[0].join('|') === 'No|Yes, just this once|Yes, all in group for this session|Yes, always\u2026',
	);
}
{
	reset();
	const realNow = Date.now;
	let clock = realNow();
	Date.now = () => clock;
	const c = mkCtx([() => { clock = realNow() + ASK_TIMEOUT_MS + 1; return undefined; }]);
	const { deps, audits } = mkDeps(c.ctx);
	check('countdown expiry → allow', (await createNetworkAsk(deps)({ host: 'example.com', port: 443 })) === true);
	check('countdown expiry audited as yes', audits.some((e) => e.decision === 'yes'));
	Date.now = realNow;
}

// --- once: covers the command's connections, not the next command ---
{
	reset();
	const c = mkCtx([(o) => o[1], undefined]);
	const { deps } = mkDeps(c.ctx);
	const ask = createNetworkAsk(deps);
	beginNetworkCommand();
	check('once → allow', (await ask({ host: 'example.com', port: 443 })) === true);
	check('once covers a second connection in the same command', (await ask({ host: 'example.com', port: 443 })) === true && c.seen.length === 1);
	endNetworkCommand();
	beginNetworkCommand();
	check('once does not survive the command', (await ask({ host: 'example.com', port: 443 })) === false && c.seen.length === 2);
	endNetworkCommand();
}

// --- session: in memory across commands (parent-domain wildcard) ---
{
	reset();
	const c = mkCtx([(o) => o[2]]);
	const { deps, audits } = mkDeps(c.ctx);
	const ask = createNetworkAsk(deps);
	check('session → allow', (await ask({ host: 'example.com' })) === true);
	check('session covers the next command without a prompt', (await ask({ host: 'example.com' })) === true && c.seen.length === 1);
	check('session notifies "not saved"', c.notified.some((m) => m.includes('this session')));
	check('session audited', audits.some((e) => e.decision === 'session' && e.grant === 'example.com'));
}
// --- session: 3-part host stores the parent-domain wildcard ---
{
	reset();
	const c = mkCtx([(o) => o[2]]);
	const { deps, audits } = mkDeps(c.ctx);
	const ask = createNetworkAsk(deps);
	check('session wildcard → allow', (await ask({ host: 'backend.composio.dev' })) === true);
	check('session wildcard covers siblings', (await ask({ host: 'api.composio.dev' })) === true && c.seen.length === 1);
	check('session wildcard audited', audits.some((e) => e.decision === 'session' && e.grant === '*.composio.dev' && e.requested === 'backend.composio.dev'));
}

// --- remember: project / global scope, persisted and applied live ---
{
	reset();
	// ADR-030 + v3.3: askRememberHost still offers the SAME 4 options for subdomains.
	// (o[3] is the second screen's exact-host-global row.)
	const c = mkCtx([(o) => o[3], (o) => o[0]]);
	const { deps, audits, persisted, live } = mkDeps(c.ctx);
	check('remember project → allow', (await createNetworkAsk(deps)({ host: 'example.com', port: 443 })) === true);
	check('remember project persists cwd scope', JSON.stringify(persisted) === '[["example.com","cwd"]]');
	check('remember applies live', live.includes('example.com'));
	check('remember project audited', audits.some((e) => e.decision === 'always-cwd' && e.persisted_to === '/work/.pi/sandbox.json'));
}
{
	reset();
	const c = mkCtx([(o) => o[3], (o) => o[3]]);
	const { deps, audits, persisted } = mkDeps(c.ctx);
	check('remember global → allow', (await createNetworkAsk(deps)({ host: 'api.example.com', port: 443 })) === true);
	check('remember global persists global scope', JSON.stringify(persisted) === '[["api.example.com","global"]]');
	check('remember global audited', audits.some((e) => e.decision === 'always-global' && e.scope === 'global'));
}

// --- screen 2 escape / screen 1 timeout ---
{
	reset();
	const c = mkCtx([(o) => o[3], undefined]);
	const { deps, persisted, live, audits } = mkDeps(c.ctx);
	check('remember escape → deny', (await createNetworkAsk(deps)({ host: 'example.com' })) === false);
	check('remember escape persists nothing', persisted.length === 0 && live.length === 0);
	check('remember escape audited no', audits.some((e) => e.decision === 'no'));
}
{
	reset();
	const c = mkCtx([(o) => o[0]]);
	const { deps } = mkDeps(c.ctx);
	check('screen 1 No → deny', (await createNetworkAsk(deps)({ host: 'example.com' })) === false);
}

// --- persist failure: allow the command, never save ---
{
	reset();
	const c = mkCtx([(o) => o[3], (o) => o[0]]);
	const { deps, audits, live } = mkDeps(c.ctx, { persistThrows: true });
	const ask = createNetworkAsk(deps);
	beginNetworkCommand();
	check('persist failure still allows', (await ask({ host: 'example.com' })) === true);
	check('persist failure applies nothing live', live.length === 0);
	check('persist failure covers the command', (await ask({ host: 'example.com' })) === true && c.seen.length === 2);
	check('persist failure audited', audits.some((e) => String(e.note).startsWith('always-persist-failed')));
	endNetworkCommand();
}

// --- single-flight and host keys ---
{
	reset();
	const c = mkCtx([(o) => o[1]]);
	const { deps } = mkDeps(c.ctx);
	const ask = createNetworkAsk(deps);
	beginNetworkCommand();
	const [a, b] = await Promise.all([ask({ host: 'example.com', port: 443 }), ask({ host: 'example.com', port: 443 })]);
	check('overlapping connections share one prompt', a === true && b === true && c.seen.length === 1);
	endNetworkCommand();
}
{
	reset();
	const c = mkCtx([(o) => o[1], (o) => o[1]]);
	const { deps, audits } = mkDeps(c.ctx);
	const ask = createNetworkAsk(deps);
	beginNetworkCommand();
	await ask({ host: 'Example.COM', port: 8443 });
	check('non-default port shown in subject', audits.some((e) => e.subject === 'example.com:8443'));
	await ask({ host: 'example.com', port: 443 });
	check('case-folded host reuses the command grant', c.seen.length === 1);
	check('default port hidden in subject', audits.some((e) => e.note === 'command-grant' && e.subject === 'example.com'));
	endNetworkCommand();
}

// --- clearing ---
{
	reset();
	const c = mkCtx([(o) => o[2], undefined]);
	const { deps } = mkDeps(c.ctx);
	const ask = createNetworkAsk(deps);
	await ask({ host: 'b.example.com' });
	clearNetworkSessionGrants();
	check('clearSession drops the session grant', (await ask({ host: 'b.example.com' })) === false && c.seen.length === 2);
}

// --- command field: shown in body, used to name the binary in the title ---
{
	reset();
	const c = mkCtx([(o) => o[1]]);
	const { deps } = mkDeps(c.ctx, { command: 'composio search googleads' });
	await createNetworkAsk(deps)({ host: 'backend.composio.dev' });
	const allText = JSON.stringify(c.seenTitles) + JSON.stringify(c.seen);
	check('command in body', allText.includes('Command  composio search googleads'));
	check('binary in title', c.seenTitles[0].includes('composio') && c.seenTitles[0].includes('connect'));
}

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);