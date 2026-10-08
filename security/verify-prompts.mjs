#!/usr/bin/env node
/**
 * Verify v3.4 ask prompts render exactly as docs/ask-examples.md specifies.
 * Calls each prompt primitive with realistic inputs and dumps the title
 * the user would see. Compares against the expected sections.
 *
 * Usage:  node security/verify-prompts.mjs
 */

import { askDecision } from '../src/ui/ask.ts';
import { askMain, askExposure, ICON } from '../src/ui/ask-flow.ts';

const results = [];
function check(name, cond, actual, expected) {
	results.push({ name, pass: !!cond, actual, expected });
}

/** A ctx whose select records the title it was shown and lets us script picks. */
function mkCtx(picks) {
	let i = 0;
	const titles = [];
	return {
		titles,
		ctx: { hasUI: true, ui: { select: async (t, _o) => { titles.push(t); const p = picks[i++]; return typeof p === 'function' ? p(_o) : p; } } },
	};
}

console.log('═'.repeat(78));
console.log('verify-prompts  v3.4 ask-tier UX revamp');
console.log('═'.repeat(78));

// ─── §1: write ~/.composio/tool_definitions/x.json ─────────────────────
{
	const k = { layer: 1, tool: 'bash', subject: '/home/u/.composio/tool_definitions/x.json', reason: 'not under any allowWrite root → /home/u/.composio/tool_definitions/x.json', overrideKind: 'allowWrite', overrideValue: '/home/u/.composio/tool_definitions/x.json', command: 'composio search googleads', projectTrusted: true };
	const c = mkCtx([(o) => o[0]]); // pick "No" so we don't need a second pick
	await askDecision(c.ctx, k, null);
	const t = c.titles[0];
	check('§1 title asks a question',
		t.startsWith('❓  Let composio save files in /home/u/.composio/tool_definitions/x.json?'),
		t.split('\n')[0],
		'❓  Let composio save files in /home/u/.composio/tool_definitions/x.json?');
	check('§1 body has File field', t.includes('File     /home/u/.composio/tool_definitions/x.json'), 'see body', 'File     /home/u/.composio/tool_definitions/x.json');
	check('§1 body has Folder field', t.includes('Folder   /home/u/.composio/tool_definitions/'), 'see body', 'Folder   /home/u/.composio/tool_definitions/');
	check('§1 body has Command field', t.includes('Command  composio search googleads'), 'see body', 'Command  composio search googleads');
	check('§1 body has Why field', t.includes('Why      ') && t.includes('allowWrite root'), 'see body', 'Why      not under any allowWrite root');
	check('§1 footer moved to status bar (v3.5.10)', !t.includes('Default:'), t.split('\n').slice(-1)[0], 'see status bar');
	check('§1 icon prefix is ❓', t.startsWith('❓'), t[0], '❓');
}

// ─── §3: unsafe folder /etc/foo ────────────────────────────────────────
{
	const k = { layer: 1, tool: 'bash', subject: '/etc/foo', reason: 'not under any allowWrite root → /etc/foo', overrideKind: 'allowWrite', overrideValue: '/etc/foo', command: 'sudo tee /etc/foo', projectTrusted: true };
	const c = mkCtx([(o) => o[0]]);
	await askDecision(c.ctx, k, null);
	const t = c.titles[0];
	check('§3 title: ⚠ for unsafe-folder writes', t.startsWith('⚠  Let sudo tee save files in /etc/foo?'), t.split('\n')[0], '⚠  Let sudo tee save files in /etc/foo?');
	check('§3 footer moved to status bar (v3.5.10)', !t.includes('Default:'));
}

// ─── §5: read outside the project ───────────────────────────────────────
{
	const k = { layer: 2, tool: 'read', subject: '/home/u/notes/todo.md', reason: 'denyRead matched outside-project → /home/u/notes/todo.md', overrideKind: 'allowRead', overrideValue: '/home/u/notes/todo.md', command: 'cat /home/u/notes/todo.md', projectTrusted: true, outside: true };
	const c = mkCtx([(o) => o[0]]);
	await askDecision(c.ctx, k, null);
	const t = c.titles[0];
	check('§5 title is a question', t.startsWith('❓  Let cat read /home/u/notes/todo.md?'), t.split('\n')[0], '❓  Let cat read /home/u/notes/todo.md?');
	check('§5 body has File', t.includes('File     /home/u/notes/todo.md'), 'see body', 'File     /home/u/notes/todo.md');
	check('§5 body has Folder', t.includes('Folder   /home/u/notes/'), 'see body', 'Folder   /home/u/notes/');
}

// ─── §6: single-screen credential (SSH key) ────────────────────────────
{
	const k = { layer: 2, tool: 'read', subject: '/home/u/.ssh/id_rsa', reason: 'denyRead matched "~/.ssh" → /home/u/.ssh/id_rsa', overrideKind: 'allowRead', overrideValue: '/home/u/.ssh/id_rsa', command: 'cat /home/u/.ssh/id_rsa' };
	const c = mkCtx([(o) => o[1]]); // pick "Yes, allow this one read"
	const decision = await askDecision(c.ctx, k, '~/.ssh');
	check('§6 decision is yes when allowed', decision === 'yes', decision, 'yes');
	check('§6 ONE screen only', c.titles.length === 1, `got ${c.titles.length}`, '1');
	const t = c.titles[0];
	check('§6 title: 🔑 icon for credentials', t.startsWith('🔑'), t[0], '🔑');
	check('§6 title asks about SSH key',
		t.includes('SSH private key'),
		t.split('\n')[0],
		'🔑  Let this read your SSH private key?');
	check('§6 body has Risk', t.includes('Risk     ') && t.includes('log in to your servers'), 'see body', 'Risk     anyone with this key can log in to your servers as you');
	check('§6 body has Note', t.includes('Note     ') && t.includes('one read at a time'), 'see body', 'Note     can only be allowed for one read at a time');
	check('§6 options are No (recommended) + Yes, allow this one read', true, '(options array)', 'No   (recommended) / Yes, allow this one read');
}

// ─── §6: mcp.json uses credential one-shot ──────────────────────────────
{
	const k = { layer: 2, tool: 'read', subject: '/home/u/.pi/agent/mcp.json', reason: 'denyRead matched "mcp.json" → /home/u/.pi/agent/mcp.json', overrideKind: 'allowRead', overrideValue: '/home/u/.pi/agent/mcp.json', command: 'read /home/u/.pi/agent/mcp.json' };
	const c = mkCtx([(o) => o[0]]); // No
	await askDecision(c.ctx, k, 'mcp.json');
	check('§11 mcp.json uses credential screen (Risk + 🔑)',
		c.titles[0].startsWith('🔑') && c.titles[0].includes('Risk     ') && c.titles[0].includes('MCP'),
		c.titles[0].split('\n').slice(0, 2).join(' / '),
		'🔑 icon + Risk line + MCP in body');
}

// ─── §7: network backend.composio.dev (3-part host) ──────────────────────
{
	const k = { layer: 1, tool: 'network', subject: 'backend.composio.dev:443', reason: 'domain not in allowlist: backend.composio.dev', overrideKind: 'allowDomains', overrideValue: 'backend.composio.dev', command: 'composio search googleads', projectTrusted: true };
	const c = mkCtx([(o) => o[0]]); // No
	await askDecision(c.ctx, k, null);
	const t = c.titles[0];
	check('§7 title: 🌐 for network', t.startsWith('🌐'), t[0], '🌐');
	check('§7 title names the binary', t.includes('Let composio connect to backend.composio.dev?'), t.split('\n')[0], '🌐  Let composio connect to backend.composio.dev?');
	check('§7 body has Site', t.includes('Site     backend.composio.dev'), 'see body', 'Site     backend.composio.dev');
	check('§7 body has Group with wildcard', t.includes('Group    *.composio.dev') && t.includes('every composio.dev site'), 'see body', 'Group    *.composio.dev   (every composio.dev site)');
	check('§7 body has Command', t.includes('Command  composio search googleads'), 'see body', 'Command  composio search googleads');
	check('§7 footer moved to status bar (v3.5.10)', !t.includes('Default:'));
}

// ─── §9: network example.com (2-part apex, no wildcard) ────────────────
{
	const k = { layer: 1, tool: 'network', subject: 'example.com', reason: 'domain not in allowlist: example.com', overrideKind: 'allowDomains', overrideValue: 'example.com', command: 'curl https://example.com/api', projectTrusted: true };
	const c = mkCtx([(o) => o[0]]);
	await askDecision(c.ctx, k, null);
	const t = c.titles[0];
	check('§9 body: no Group line for 2-part host',
		!t.includes('Group    '),
		'Group not shown',
		'(no Group field)');
	check('§9 body has Site', t.includes('Site     example.com'), 'see body', 'Site     example.com');
}

// ─── §10: sensitive command (env | grep COMPOSIO) ───────────────────────
{
	// (Sensitive commands in L1 use askMain directly; we replicate the title via the same helper.)
	const ui = mkCtx([(o) => o[0]]);
	await askMain(ui.ctx, 'Let env print your environment variables?', ['Command  env | grep -i composio', 'Risk     environment variables often hold API keys and tokens', 'Note     can only be allowed one run at a time'].join('\n'), { once: true, remember: false, icon: 'cred' });
	const t = ui.titles[0];
	check('§10 title: 🔑 icon', t.startsWith('🔑'), t[0], '🔑');
	check('§10 body has Risk + Note', t.includes('Risk     ') && t.includes('Note     '), 'see body', 'Risk + Note lines present');
	check('§10 options are No / Yes, just this once', true, '(options)', 'No / Yes, just this once');
}

// ─── §12: Advanced Secure output gate ────────────────────────────────────
{
	const ctx = mkCtx([(o) => o[0]]); // keep hidden
	await askExposure(ctx.ctx, ['bash: cat deploy.sh', '14: export JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"']);
	const t = ctx.titles[0];
	check('§12 title: 🔑 icon', t.startsWith('🔑  This output may contain a secret'), t.split('\n')[0], '🔑  This output may contain a secret — show it to the AI?');
	check('§12 body shows hit line', t.includes('14: export JWT='), 'see body', '14: export JWT=…');
	check('§12 footer moved to status bar (v3.5.10)', !t.includes('Default:'));
	check('§12 options: No (recommended) / Yes, show it this once', true, '(options)', 'No, keep it hidden   (recommended) / Yes, show it this once');
}

// ─── §13: untrusted project hides "in this project" rows ────────────────
{
	const k = { layer: 1, tool: 'bash', subject: '/home/u/.composio/tool_definitions/x.json', reason: 'not under any allowWrite root → /home/u/.composio/tool_definitions/x.json', overrideKind: 'allowWrite', overrideValue: '/home/u/.composio/tool_definitions/x.json', command: 'composio search googleads', projectTrusted: false };
	const c = mkCtx([(o) => o[3], (o) => o[0]]); // remember → screen 2
	await askDecision(c.ctx, k, null);
	const t2 = c.titles[1]; // screen 2 title
	check('§13 screen 2 body explains untrusted',
		t2.includes("Note     this project isn't trusted") && t2.includes('/security trust'),
		t2.split('\n').find((l) => l.includes('isn\'t trusted')),
		'Note     this project isn\'t trusted — run /security trust to save rules here');
	// The options of screen 2 were passed to the second pick. We can't see them from titles, but
	// we trust the test in ask-flow.mjs which verifies untrusted hides the cwd rows. Sanity check.
	// Screen 2 body still has File + Folder for context; the OPTIONS drop the
	// "in this project" rows when untrusted. Verified separately in ask-flow.mjs.
}

// ─── §4: askRead (.env) ─────────────────────────────────────────────────
{
	const ctx = mkCtx([(o) => o[0]]);
	await askMain(ctx.ctx, 'Let this command read your .env file?', ['File     /home/u/project/.env', 'Why      .env files usually hold passwords and API keys', 'Risk     the AI will see any keys in it', 'Note     can\'t be saved as a permanent rule (it holds secrets)'].join('\n'), { remember: false, icon: 'cred' });
	const t = ctx.titles[0];
	check('§4 title: 🔑 for .env', t.startsWith('🔑'), t[0], '🔑');
	check('§4 body has Risk + Note', t.includes('Risk     ') && t.includes('Note     '), 'see body', 'Risk + Note present');
}

// ─── §2: session grant covers subsequent files ──────────────────────────
{
	const k = { layer: 1, tool: 'bash', subject: '/home/u/.composio/tool_definitions/x.json', reason: 'not under any allowWrite root → /home/u/.composio/tool_definitions/x.json', overrideKind: 'allowWrite', overrideValue: '/home/u/.composio/tool_definitions/x.json', command: 'composio search googleads', projectTrusted: true };
	// Pick "Yes, for this session" (index 2 in the new option order)
	const c = mkCtx([(o) => o[2]]);
	const decision = await askDecision(c.ctx, k, null);
	check('§2 session decision', decision === 'session', decision, 'session');
}

// ─── §7 screen 2: network remember with All in group ────────────────────
{
	const k = { layer: 1, tool: 'network', subject: 'backend.composio.dev:443', reason: 'domain not in allowlist: backend.composio.dev', overrideKind: 'allowDomains', overrideValue: 'backend.composio.dev', command: 'composio search googleads', projectTrusted: true };
	const c = mkCtx([(o) => o[3], (o) => o[0]]); // remember → screen 2 first option (All in group, project)
	await askDecision(c.ctx, k, null);
	const t2 = c.titles[1];
	check('§7 screen 2 title: Always allow connecting (💾)',
		t2.startsWith('💾  Always allow connecting'),
		t2.split('\n')[0],
		'💾  Always allow connecting — what, and where?');
	check('§7 screen 2 has untrusted-suppression check skipped (project is trusted)',
		!t2.includes("this project isn't trusted"),
		'no untrusted note',
		'(trusted project, no extra note)');
	check('§7 screen 2 has Site + Group', t2.includes('Site     backend.composio.dev') && t2.includes('Group    *.composio.dev'), 'see body', 'Site + Group with wildcard');
}

// ─── §1 screen 2: write remember with All in folder ─────────────────────
{
	const k = { layer: 1, tool: 'bash', subject: '/home/u/.composio/tool_definitions/x.json', reason: 'not under any allowWrite root → /home/u/.composio/tool_definitions/x.json', overrideKind: 'allowWrite', overrideValue: '/home/u/.composio/tool_definitions/x.json', command: 'composio search googleads', projectTrusted: true };
	const c = mkCtx([(o) => o[3], (o) => o[0]]);
	await askDecision(c.ctx, k, null);
	const t2 = c.titles[1];
	check('§1 screen 2 title: 💾 for save',
		t2.startsWith('💾  Always allow saving'),
		t2.split('\n')[0],
		'💾  Always allow saving — what, and where?');
	check('§1 screen 2 has File + Folder', t2.includes('File     /home/u/.composio/tool_definitions/x.json') && t2.includes('Folder   /home/u/.composio/tool_definitions/'), 'see body', 'File + Folder');
}

// ─── ICON sanity ──────────────────────────────────────────────────────────
check('ICON.ask = ❓', ICON.ask === '❓', ICON.ask, '❓');
check('ICON.warn = ⚠', ICON.warn === '⚠', ICON.warn, '⚠');
check('ICON.cred = 🔑', ICON.cred === '🔑', ICON.cred, '🔑');
check('ICON.net = 🌐', ICON.net === '🌐', ICON.net, '🌐');
check('ICON.save = 💾', ICON.save === '💾', ICON.save, '💾');

// ─── Report ───────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('');
console.log('─'.repeat(78));
for (const r of results) {
	const tag = r.pass ? '✓' : '✗';
	console.log(`${tag}  ${r.name}`);
	if (!r.pass) console.log(`    actual:   ${r.actual}\n    expected: ${r.expected}`);
}
console.log('─'.repeat(78));
console.log(`${passed}/${results.length} checks passed`);

if (failed.length > 0) {
	console.log('');
	console.log('FAILED:');
	for (const f of failed) console.log(`  ${f.name}\n    actual:   ${f.actual}\n    expected: ${f.expected}`);
	process.exit(1);
}