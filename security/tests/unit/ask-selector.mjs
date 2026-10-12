// Custom TUI ask selector (src/ui/ask-selector.ts, ADR-031).
// The footer shows a live countdown, disappears the moment the user moves the
// selection, and expiry is exact (Esc is never mistaken for the countdown).
// Keyboard only (ADR-036): mouse events are inert, only Enter picks a row.
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

// --- mouse is inert (ADR-036): pi's SelectList picks the row a left click
// lands on and moves the highlight on wheel, so the selector must never
// forward mouse events to it. Only Enter may pick a row. ---
const mouse = (overrides = {}) => ({
	type: 'click', button: 'left', x: 0, y: 0, screenX: 0, screenY: 0,
	width: 80, height: 17, shift: false, alt: false, ctrl: false, ...overrides,
});
{
	const s = mk();
	const lines = s.comp.render(80);
	const yesRow = lines.findIndex((l) => l.includes('Yes, just this once'));
	check('mouse: option row found to aim a click at', yesRow > 0);
	s.comp.handleMouse(mouse({ y: yesRow, screenY: yesRow }));
	check('mouse: click does not settle the prompt', s.result === undefined);
	check('mouse: click does not move the highlight', text(s.comp).includes('→ No'));
	check('mouse: click does not hide the footer', text(s.comp).includes('Default: Yes, just this once (15s)'));
	s.comp.handleInput('\r');
	check('mouse: Enter still picks the keyboard-highlighted row (No)', s.result === 'No');
}
{
	const s = mk();
	const before = text(s.comp);
	s.comp.handleMouse(mouse({ type: 'wheel', button: 'none', wheelDelta: 1 }));
	s.comp.handleMouse(mouse({ type: 'wheel', button: 'none', wheelDelta: 1 }));
	check('mouse: wheel does not move the highlight', text(s.comp) === before);
	check('mouse: wheel does not hide the footer', text(s.comp).includes('Default: Yes, just this once (15s)'));
	check('mouse: wheel does not settle the prompt', s.result === undefined);
}
{
	const s = mk();
	s.comp.handleMouse(mouse({ type: 'press', y: 3, screenY: 3 }));
	s.comp.handleMouse(mouse({ type: 'release', y: 3, screenY: 3 }));
	s.comp.handleMouse(mouse({ type: 'click', y: 3, screenY: 3 }));
	check('mouse: press/release/click leave the prompt unsettled', s.result === undefined);
	s.comp.handleInput('\x1b[B');
	s.comp.handleInput('\r');
	check('mouse: keyboard still works after a stray click', s.result === 'Yes, just this once');
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

// --- navigating restarts the FULL timeout (ADR-031, v3.7.5 regression): the
// counter used to be left where it was, so a prompt expired seconds early and
// auto-answered even though the user was still reading. timeoutMs is in
// seconds (ceil), so give it several ticks to make the restart observable. ---
{
	let result; let expired = false;
	const comp = new AskSelector({
		title: TITLE,
		footer: 'Default: Yes, just this once',
		options: OPTIONS,
		timeoutMs: 5000,
		tickMs: 200,
		tui,
		theme,
		keybindings,
		done: (r) => { result = r; },
		onExpire: () => { expired = true; },
	});
	await sleep(450); // ~2 of 5 ticks elapsed
	comp.handleInput('\x1b[B');
	const restarted = text(comp);
	check('activity: footer is hidden on navigation', !restarted.includes('Default:'));
	// Without the reset this would expire at ~1050ms; with it, at ~1450ms.
	await sleep(750); // t ~= 1200ms
	check('activity: full timeout restarts (not expired mid-way)', expired === false && result === undefined);
	comp.dispose();
}

// --- disposing after navigation still stops the restarted countdown ---
{
	let expired = false;
	const comp = new AskSelector({
		title: TITLE,
		footer: 'Default: Yes, just this once',
		options: OPTIONS,
		timeoutMs: 5000,
		tickMs: 200,
		tui,
		theme,
		keybindings,
		done: () => {},
		onExpire: () => { expired = true; },
	});
	await sleep(450);
	comp.handleInput('\x1b[B');
	comp.dispose();
	await sleep(1200);
	check('activity: dispose stops the restarted countdown', expired === false);
}

// --- dispose stops the countdown (component replaced before it fires) ---
{
	const s = mk({ timeoutMs: 50, tickMs: 5 });
	s.comp.dispose();
	await sleep(40);
	check('dispose() stops the countdown', s.expired === false);
}

// --- dispose settles the promise (ADR-034): pi drops a displaced prompt without
// calling `done`, and an unsettled ask wedges the shared queue for every later
// prompt. dispose must resolve it exactly once, without counting as expiry. ---
{
	let settles = 0;
	const s = mk({ done: () => { settles++; } });
	s.comp.dispose();
	check('dispose() settles the pending prompt', settles === 1);
	s.comp.dispose();
	check('dispose() is idempotent', settles === 1);
}
{
	let settles = 0;
	const s = mk({ done: () => { settles++; } });
	s.comp.handleInput('\r');
	check('pick settles once', settles === 1);
	s.comp.dispose();
	check('dispose() after a pick does not settle again', settles === 1);
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
