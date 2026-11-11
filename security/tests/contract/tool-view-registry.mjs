import { Text, visibleWidth } from '@earendil-works/pi-tui';
import { ownsTool } from '../../../src/core/tool-view/labels.ts';
import { setActiveViewMode } from '../../../src/tool-view/session.ts';
import { endAllCalls } from '../../../src/tool-view/live-clock.ts';
import { toolViewRenderers } from '../../../src/tool-view/renderers.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const theme = { fg: (color, text) => text };
const FALLBACK_TEXT = 'pi-block';

const fallback = {
	renderShell: 'default',
	renderCall: () => new Text(FALLBACK_TEXT),
	renderResult: () => new Text(FALLBACK_TEXT),
};

const context = (overrides = {}) => ({
	args: { path: 'src/a.ts' },
	toolCallId: 'call-1',
	invalidate: () => {},
	lastComponent: undefined,
	state: {},
	cwd: '/work/project',
	executionStarted: true,
	argsComplete: true,
	isPartial: false,
	expanded: false,
	showImages: false,
	isError: false,
	durationMs: 1500,
	outputPad: 1,
	keyText: () => 'ctrl+o',
	keyHint: () => 'ctrl+o to expand',
	...overrides,
});

const lines = (component, width = 100) => component.render(width);
const showsFallback = (component) => lines(component).some((line) => line.trim() === FALLBACK_TEXT);
const callOf = (toolName, overrides) => toolViewRenderers(toolName, fallback).renderCall({ path: 'src/a.ts' }, theme, context({ durationMs: undefined, ...overrides }));
const resultOf = (toolName, overrides) =>
	toolViewRenderers(toolName, fallback).renderResult({ content: [{ type: 'text', text: 'ok' }] }, { expanded: false, isPartial: false }, theme, context(overrides));

setActiveViewMode('full');
check('full view hands a read back to Pi', showsFallback(callOf('read')));
check('full view hands a result back to Pi', showsFallback(resultOf('read')));

setActiveViewMode('compact');
check('compact view owns the shell too', toolViewRenderers('bash', fallback).renderShell === 'self');
check('a read renders one row line', lines(callOf('read')).length === 1);
check('the running read row', lines(callOf('read'))[0] === '● Reading 1 file (src/a.ts) · 0s ctrl+o to expand');
check('the finished read row', lines(resultOf('read')).some((line) => line === '✓ Reading 1 file (src/a.ts) · 1s ctrl+o to expand'));

const settledCall = (overrides) => toolViewRenderers('read', fallback).renderCall({ path: 'src/a.ts' }, theme, context(overrides));
check('a settled call leaves the row to the result', lines(settledCall({ durationMs: 1500 })).join('').trim() === '');
check('a settled call does not draw a second row', !lines(settledCall({ durationMs: 1500 })).some((line) => line.includes('Reading')));
check('a failed call leaves the row to the result', lines(settledCall({ durationMs: undefined, isError: true })).join('').trim() === '');
check('a replayed settled call stays empty', lines(settledCall({ durationMs: undefined, state: { settled: true } })).join('').trim() === '');

const bashCall = toolViewRenderers('bash', fallback).renderCall({ command: 'npm test' }, theme, context({ toolCallId: 'call-bash', durationMs: undefined }));
check('a shell call renders two lines', lines(bashCall).length === 2);
check('the shell row has no expand hint', lines(bashCall)[0] === '● Running 1 command · 0s');
check('the shell row shows the command', lines(bashCall)[1] === '   └ $ npm test');

const failedBash = toolViewRenderers('bash', fallback).renderResult(
	{ content: [{ type: 'text', text: 'boom' }] },
	{ expanded: false, isPartial: false },
	theme,
	context({ toolCallId: 'call-bash', args: { command: 'npm test' }, isError: true }),
);
check('a failed shell row says so', lines(failedBash)[0] === '✗ Running 1 command · 1s');

const blockedRead = toolViewRenderers('read', fallback).renderResult(
	{ content: [{ type: 'text', text: 'Read blocked by policy: sensitive file' }] },
	{ expanded: false, isPartial: false },
	theme,
	context({ args: { path: 'id_rsa' }, isError: true }),
);
check('a blocked read keeps the word', lines(blockedRead)[0] === '✗ blocked Reading 1 file (id_rsa) · 1s ctrl+o to expand');

const deniedShell = toolViewRenderers('bash', fallback).renderResult(
	{ content: [{ type: 'text', text: '[Security Block] sandbox: read access to /x was denied by user.' }] },
	{ expanded: false, isPartial: false },
	theme,
	context({ args: { command: 'curl https://x' }, isError: true }),
);
check('a denied call keeps the word', lines(deniedShell)[0] === '✗ denied Running 1 command · 1s');

check('an expanded call is Pi own block', showsFallback(callOf('read', { expanded: true })));
check('a call without complete args is Pi own block', showsFallback(callOf('read', { argsComplete: false })));
check(
	'an expanded result is Pi own block',
	lines(
		toolViewRenderers('read', fallback).renderResult(
			{ content: [] },
			{ expanded: true, isPartial: false },
			theme,
			context(),
		),
	).some((line) => line.trim() === FALLBACK_TEXT),
);

check('a wide row is untouched', lines(callOf('read', { cwd: '/work/project' }), 200)[0].includes('Reading'));
const narrowRow = lines(callOf('read'), 24)[0];
check('a narrow row is cut with an ellipsis', narrowRow.includes('…'));
check('a narrow row never exceeds the width', visibleWidth(narrowRow) <= 24);

check('write is not owned (Pi keeps its block)', ownsTool('write') === false);
check('an unknown tool keeps Pi renderers', ownsTool('mcp__docs__search') === false);

endAllCalls();
setActiveViewMode('full');

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
