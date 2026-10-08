// Custom TUI ask selector (src/ui/ask-selector.ts, ADR-031).
// The footer shows a live countdown, disappears the moment the user moves the
// selection, and expiry is exact (Esc is never mistaken for the countdown).
import { getKeybindings } from '@earendil-works/pi-tui';
import { AskSelector } from '../../../src/ui/ask-selector.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const theme = { fg: (_color, text) => text, bold: (text) => text };
const tui = { requestRender() {} };
const keybindings = getKeybindings();
const TITLE = [
	'🌐  Let composio connect to us.i.posthog.com?',
	'Site     us.i.posthog.com',
	"Group    *.posthog.com   (every posthog.com site)",
	'Why      this site isn\'t on your allowed list yet',
].join('\n');
const OPTIONS = ['No', 'Yes, just this once', 'Yes, all in group for this session', 'Yes, always…'];

function mk(overrides = {}) {
	let result;
	let expired = false;
	const comp = new AskSelector({
		title: TITLE,
		footer: 'Default: Yes, just this once',
		options: OPTIONS,
		timeoutMs: 15_000,
		tui,
		theme,
		keybindings,
		done: (r) => { result = r; },
		onExpire: () => { expired = true; },
		...overrides,
	});
	return { comp, get result() { return result; }, get expired() { return expired; } };
}
const text = (comp) => comp.render(80).join('\n');

// --- initial render: footer with countdown, title unindented, No selected ---
{
	const s = mk();
	const lines = s.comp.render(80);
	const t = lines.join('\n');
	check('initial: footer shows the live countdown', t.includes('Default: Yes, just this once (15s)'));
	check('initial: title starts at column 0 (no pi padding)', lines[2].startsWith('🌐  Let composio'));
	check('initial: selected row is → No', t.includes('→ No'));
	check('initial: other rows are indented two spaces', t.includes('\n  Yes, just this once'));
}

// --- the first ↓ hides the footer and moves the selection ---
{
	const s = mk();
	s.comp.handleInput('\x1b[B');
	const t = text(s.comp);
	check('after ↓: footer is gone', !t.includes('Default:'));
	check('after ↓: arrow moved to row 2', t.includes('→ Yes, just this once') && !t.includes('→ No'));
	check('after ↓: ↑ brings the selection back, not the footer', (() => {
		s.comp.handleInput('\x1b[A');
		const t2 = text(s.comp);
		return t2.includes('→ No') && !t2.includes('Default:');
	})());
}

// --- Enter returns the highlighted label ---
{
	const s = mk();
	s.comp.handleInput('\x1b[B');
	s.comp.handleInput('\r');
	check('Enter returns the highlighted option', s.result === 'Yes, just this once');
	check('Enter is not an expiry', s.expired === false);
}
{
	const s = mk();
	s.comp.handleInput('\r');
	check('Enter without navigation returns the default row (No)', s.result === 'No');
}

// --- ↑/↓ clamp at the ends (the previous selector never wrapped) ---
{
	const s = mk();
	s.comp.handleInput('\x1b[A');
	check('↑ at the top row stays on No', (() => {
		s.comp.handleInput('\r');
		return s.result === 'No';
	})());
}
{
	const s = mk();
	s.comp.handleInput('\x1b[B');
	s.comp.handleInput('\x1b[B');
	s.comp.handleInput('\x1b[B');
	s.comp.handleInput('\x1b[B');
	s.comp.handleInput('\x1b[B');
	s.comp.handleInput('\r');
	check('↓ at the last row stays on Yes, always…', s.result === 'Yes, always…');
}

// --- Esc returns undefined and is not an expiry ---
{
	const s = mk();
	s.comp.handleInput('\x1b');
	check('Esc returns undefined', s.result === undefined);
	check('Esc is not an expiry', s.expired === false);
}

// --- countdown expiry calls onExpire and resolves undefined ---
{
	const s = mk({ timeoutMs: 50, tickMs: 5 });
	await sleep(40);
	check('expiry calls onExpire', s.expired === true);
	check('expiry resolves undefined (caller maps the default)', s.result === undefined);
}

// --- dispose stops the countdown (component replaced before it fires) ---
{
	const s = mk({ timeoutMs: 50, tickMs: 5 });
	s.comp.dispose();
	await sleep(40);
	check('dispose() stops the countdown', s.expired === false);
}

// --- timeoutMs 0: footer without a countdown, no auto-dismiss ---
{
	const s = mk({ timeoutMs: 0 });
	const t = text(s.comp);
	check('timeout 0: footer has no (Ns)', t.includes('Default: Yes, just this once') && !t.includes('(15s)'));
	await sleep(20);
	check('timeout 0: no expiry', s.expired === false && s.result === undefined);
}

// --- no footer: options only, no stray Default line ---
{
	const s = mk({ footer: null });
	check('footer null: no Default line', !text(s.comp).includes('Default:'));
}

console.log(`PASS=${pass} FAIL=${fail}`);
if (fail) process.exit(1);
