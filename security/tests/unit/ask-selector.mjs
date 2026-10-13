// Custom TUI ask selector (src/ui/ask-selector.ts, ADR-031, ADR-039).
// The footer shows a live countdown and disappears the moment the user moves the
// selection; the first ↕/↓ cancels the countdown so Enter/Esc alone decide.
// Expiry is exact (Esc is never mistaken for the countdown).
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
const OPTIONS = ['No', 'Yes, just this once', 'Yes, all in group for this conversation', 'Yes, always…'];

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

{
	const s = mk();
	const lines = s.comp.render(80);
	const t = lines.join('\n');
	check('initial: footer shows the live countdown', t.includes('Default: Yes, just this once (15s)'));
	check('initial: title starts at column 0 (no pi padding)', lines[2].startsWith('🌐  Let composio'));
	check('initial: selected row is → No', t.includes('→ No'));
	check('initial: other rows are indented two spaces', t.includes('\n  Yes, just this once'));
}

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

{
	const s = mk();
	s.comp.handleInput('\x1b');
	check('Esc returns undefined', s.result === undefined);
	check('Esc is not an expiry', s.expired === false);
}

{
	const s = mk({ timeoutMs: 50, tickMs: 5 });
	await sleep(40);
	check('expiry calls onExpire', s.expired === true);
	check('expiry resolves undefined (caller maps the default)', s.result === undefined);
}

{
	let result; let expired = false;
	const comp = new AskSelector({
		title: TITLE,
		footer: 'Default: Yes, just this once',
		options: OPTIONS,
		timeoutMs: 5000,
		tickMs: 100,
		tui,
		theme,
		keybindings,
		done: (r) => { result = r; },
		onExpire: () => { expired = true; },
	});
	await sleep(200);
	comp.handleInput('\x1b[B');
	check('activity: footer is hidden on navigation', !text(comp).includes('Default:'));
	await sleep(1000);
	check('activity: navigation cancels the countdown', expired === false && result === undefined);
	comp.handleInput('\r');
	check('activity: Enter after navigation picks the highlighted row', result === 'Yes, just this once', String(result));
	check('activity: the pick is not an expiry', expired === false);
}

{
	let result; let expired = false;
	const comp = new AskSelector({
		title: TITLE,
		footer: 'Default: Yes, just this once',
		options: OPTIONS,
		timeoutMs: 5000,
		tickMs: 100,
		tui,
		theme,
		keybindings,
		done: (r) => { result = r; },
		onExpire: () => { expired = true; },
	});
	await sleep(200);
	comp.handleInput('\x1b[B');
	await sleep(1000);
	comp.handleInput('\x1b');
	check('activity: Esc after navigation cancels without expiry', result === undefined && expired === false);
	comp.dispose();
}

{
	const s = mk({ timeoutMs: 50, tickMs: 5 });
	s.comp.dispose();
	await sleep(40);
	check('dispose() stops the countdown', s.expired === false);
}

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

{
	const s = mk({ timeoutMs: 0 });
	const t = text(s.comp);
	check('timeout 0: footer has no (Ns)', t.includes('Default: Yes, just this once') && !t.includes('(15s)'));
	await sleep(20);
	check('timeout 0: no expiry', s.expired === false && s.result === undefined);
}

{
	const s = mk({ footer: null });
	check('footer null: no Default line', !text(s.comp).includes('Default:'));
}

console.log(`PASS=${pass} FAIL=${fail}`);
if (fail) process.exit(1);
