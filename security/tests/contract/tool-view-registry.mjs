import { Text, visibleWidth } from '@earendil-works/pi-tui';
import { isCommandTool } from '../../../src/core/tool-view/labels.ts';
import { setActiveViewMode } from '../../../src/tool-view/session.ts';
import { closeCommandGroup, resetCommandGroups } from '../../../src/tool-view/command-groups.ts';
import { toolViewRenderers } from '../../../src/tool-view/renderers.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const theme = { fg: (name, text) => text, bold: (text) => text, bg: (name, text) => text };
const FALLBACK_TEXT = 'pi-renderer';
const DENIAL_TEXT = '[Security Block] sandbox: read access to /x was denied by user.';

const fallback = {
	renderShell: 'default',
	renderCall: () => new Text(FALLBACK_TEXT),
	renderResult: () => new Text(FALLBACK_TEXT),
};

const context = (overrides = {}) => ({
	args: { command: 'npm test' },
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
	durationMs: undefined,
	outputPad: 1,
	keyText: () => 'ctrl+o',
	keyHint: () => 'ctrl+o to expand',
	...overrides,
});

const lines = (component, width = 100) => component.render(width);
const showsFallback = (component) => lines(component).some((line) => line.trim() === FALLBACK_TEXT);
const callOf = (toolName, args, overrides) =>
	toolViewRenderers(toolName, fallback).renderCall(args, theme, context({ durationMs: undefined, args, ...overrides }));
const resultOf = (toolName, args, overrides, text = 'ok') =>
	toolViewRenderers(toolName, fallback).renderResult(
		{ content: [{ type: 'text', text }] },
		{ expanded: false, isPartial: false },
		theme,
		context({ args, ...overrides }),
	);

resetCommandGroups();
setActiveViewMode('full');
check('full view hands a command back to Pi', showsFallback(callOf('bash', { command: 'npm test' })));
check('full view hands a result back to Pi', showsFallback(resultOf('bash', { command: 'npm test' })));

setActiveViewMode('compact');
check('compact view owns the shell', toolViewRenderers('bash', fallback).renderShell === 'self');
check('a read is not a command tool', isCommandTool('read') === false);
check('a read call keeps Pi own block', showsFallback(callOf('read', { path: 'src/a.ts' })));
check('a read result keeps Pi own block', showsFallback(resultOf('read', { path: 'src/a.ts' })));
check('an edit keeps Pi own block', showsFallback(callOf('edit', { path: 'src/a.ts' })));
check('a call without a command keeps Pi own block', showsFallback(callOf('bash', {})));
check('an expanded command is Pi own block', showsFallback(callOf('bash', { command: 'npm test' }, { expanded: true })));
check(
	'a command without complete arguments is Pi own block',
	showsFallback(callOf('bash', { command: 'npm test' }, { argsComplete: false })),
);

const bashCall = callOf('bash', { command: 'npm test' }, { toolCallId: 'call-bash' });
check('a command call renders two lines', lines(bashCall).length === 2);
check('the command row marks the running group', lines(bashCall)[0].startsWith('● Running 1 command · '));
check('the newest row has no expand hint', !lines(bashCall)[0].includes('ctrl+o'));
check('the command row shows the command line', lines(bashCall)[1] === '  └ $ npm test');

const failedBash = resultOf('bash', { command: 'npm test' }, { toolCallId: 'call-bash', isError: true, durationMs: 1500 });
check('a failed command row says so', lines(failedBash)[0] === '✗ Running 1 command · 1.5s');
check('a single failed command keeps its one line', lines(failedBash)[1] === '  └ $ npm test');

const joinedBash = callOf('bash', { command: 'npm run build' }, { toolCallId: 'call-build' });
check('a second command joins the running group silently', lines(joinedBash).length === 0);

const repaintedGroup = lines(resultOf('bash', { command: 'npm test' }, { toolCallId: 'call-bash', isError: true, durationMs: 1500 }));
check('the group row counts both commands', repaintedGroup[0].startsWith('● Running 2 commands · '));
check('the group row takes the last command mark', repaintedGroup[0].startsWith('●'));
check('an open group carries no expand hint', !repaintedGroup[0].includes('ctrl+o'));
check('the first command keeps its mark and duration', repaintedGroup[1] === '  └ ✗ $ npm test 1.5s');
check('the running command reads with an ellipsis', repaintedGroup[2] === '  └ … $ npm run build');

const settledSecond = resultOf('bash', { command: 'npm run build' }, { toolCallId: 'call-build', durationMs: 3000 });
check('a settled member leaves the drawing to the head', lines(settledSecond).length === 0);

const settledGroup = lines(resultOf('bash', { command: 'npm test' }, { toolCallId: 'call-bash', isError: true, durationMs: 1500 }));
check('the settled group ends on the last command', settledGroup[0].startsWith('✓ Running 2 commands · '));
check('the second command line settles with its duration', settledGroup[2] === '  └ ✓ $ npm run build 3s');

const foldableGroup = resultOf('bash', { command: 'npm test' }, { toolCallId: 'call-bash', isError: true, durationMs: 1500 });
closeCommandGroup();
check('a closed group folds to one line', lines(foldableGroup).length === 1);
check('the folded row names the last command', lines(foldableGroup)[0].includes('(npm run build)'));
check('the folded row carries the expand hint', lines(foldableGroup)[0].endsWith('ctrl+o to expand'));

const deniedShell = resultOf(
	'bash',
	{ command: 'curl https://x' },
	{ toolCallId: 'call-curl', isError: true, durationMs: 900, state: { settled: true } },
	DENIAL_TEXT,
);
check('a denied call says so on its row', lines(deniedShell)[0] === '✗ Running 1 command · 900ms denied');
check('a denied call keeps its command line', lines(deniedShell)[1] === '  └ $ curl https://x');

const deniedSecond = resultOf(
	'bash',
	{ command: 'curl https://y' },
	{ toolCallId: 'call-curl-2', isError: true, durationMs: 900 },
	DENIAL_TEXT,
);
check('a denied member leaves the drawing to the head', lines(deniedSecond).length === 0);

const deniedGroup = lines(
	resultOf('bash', { command: 'curl https://x' }, { toolCallId: 'call-curl', isError: true, durationMs: 900 }, DENIAL_TEXT),
);
check('a group of two counts both commands', deniedGroup[0].startsWith('✗ Running 2 commands · '));
check('a denied line in a group names its gate', deniedGroup[2] === '  └ ✗ $ curl https://y 900ms denied');

closeCommandGroup();
const settledCall = callOf('bash', { command: 'git status' }, { toolCallId: 'call-git', durationMs: 400 });
check('a settled call leaves the row to the result', lines(settledCall).join('').trim() === '');
check(
	'a replayed settled call stays empty',
	lines(callOf('bash', { command: 'git status' }, { toolCallId: 'call-git', durationMs: undefined, state: { settled: true } })).join('').trim() === '',
);

closeCommandGroup();
const powershellCall = callOf('powershell', { command: 'Get-ChildItem' }, { toolCallId: 'call-ps' });
check('powershell is compacted the same way', lines(powershellCall)[1] === '  └ $ Get-ChildItem');
check('powershell keeps its own command word', lines(powershellCall)[0].includes('Running 1 command'));

const narrowRow = lines(powershellCall, 16)[1];
check('a narrow command line is cut with an ellipsis', narrowRow.includes('…'));
check('a narrow command line never exceeds the width', visibleWidth(narrowRow) <= 16);
check('a wide command line is untouched', lines(powershellCall, 200)[1] === '  └ $ Get-ChildItem');

check('write is not a command tool', isCommandTool('write') === false);
check('an unknown tool keeps Pi renderers', isCommandTool('mcp__docs__search') === false);

resetCommandGroups();
setActiveViewMode('full');

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
