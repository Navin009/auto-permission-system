import { Container, Spacer, Text, visibleWidth } from '@earendil-works/pi-tui';
import { setActiveViewMode } from '../../../src/tool-view/session.ts';
import { closeCommandGroup, resetCommandGroups } from '../../../src/tool-view/command-groups.ts';
import { PiBlockComponent } from '../../../src/tool-view/pi-block.ts';
import { toolViewRenderers } from '../../../src/tool-view/renderers.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const WIDTH = 40;

const backgrounds = [];
const theme = {
	fg: (name, text) => text,
	bold: (text) => text,
	bg: (name, text) => { backgrounds.push(name); return text; },
};

const fallback = {
	renderShell: 'default',
	renderCall: (args, _theme, context) => {
		const text = context.lastComponent ?? new Text('', 0, 0);
		text.setText(`$ ${args.command}`);
		return text;
	},
	renderResult: (_result, _options, _theme, context) => {
		const container = context.lastComponent ?? new Container();
		container.clear();
		container.addChild(new Spacer(1));
		container.addChild(new Text('done', 0, 0));
		return container;
	},
};

const result = { content: [{ type: 'text', text: 'done' }] };

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
	expanded: true,
	showImages: false,
	isError: false,
	durationMs: undefined,
	outputPad: 1,
	keyText: () => 'ctrl+o',
	keyHint: () => 'ctrl+o to expand',
	...overrides,
});

const renderers = toolViewRenderers('bash', fallback);
const lines = (component, width = WIDTH) => component.render(width);
const callAt = (overrides) => renderers.renderCall({ command: 'npm test' }, theme, context(overrides));

resetCommandGroups();
setActiveViewMode('compact');

backgrounds.length = 0;
const callBlock = callAt({ toolCallId: 'call-block' });
const callLines = lines(callBlock);
check('an expanded call is Pi own block component', callBlock instanceof PiBlockComponent);
check('the block opens with Pi top padding', callLines.length === 3 && callLines[0].trim() === '');
check('the block draws Pi own command line', callLines[1].trim() === '$ npm test');
check('the block closes with Pi bottom padding', callLines[2].trim() === '');
check('the block fills every line to the terminal width', callLines.every((line) => visibleWidth(line) === WIDTH));
check('the block paints the success background', backgrounds.includes('toolSuccessBg'));

const rowContext = context({ toolCallId: 'call-row' });
const rowBlock = renderers.renderCall({ command: 'npm test' }, theme, rowContext);
const resultSlot = renderers.renderResult(result, { expanded: true, isPartial: false }, theme, { ...rowContext, lastComponent: undefined });
check('the result slot draws no lines of its own', lines(resultSlot).length === 0);
check('the block grows to hold Pi own result', lines(rowBlock).length === 5);
check('the result sits under the command', lines(rowBlock)[2].trim() === '' && lines(rowBlock)[3].trim() === 'done');
check('the block keeps its bottom padding after the result', lines(rowBlock)[4].trim() === '');

const repaintedBlock = renderers.renderCall({ command: 'npm test' }, theme, { ...rowContext, lastComponent: rowBlock });
check('a repaint reuses the block component', repaintedBlock === rowBlock);
check('a repaint does not duplicate the command', lines(repaintedBlock).length === 5);
check('a repaint keeps the result in place', lines(repaintedBlock)[3].trim() === 'done');

backgrounds.length = 0;
const failedBlock = renderers.renderCall({ command: 'npm test' }, theme, { ...rowContext, lastComponent: rowBlock, isError: true });
lines(failedBlock);
check('a failed call paints the error background', backgrounds.includes('toolErrorBg'));

backgrounds.length = 0;
const pendingBlock = renderers.renderCall(
	{ command: 'npm test' },
	theme,
	{ ...rowContext, lastComponent: rowBlock, isError: false, isPartial: true },
);
lines(pendingBlock);
check('a running call paints the pending background', backgrounds.includes('toolPendingBg'));

const paddedLines = lines(callAt({ toolCallId: 'call-pad', outputPad: 2 }));
check('the block keeps Pi own output padding', paddedLines[1].startsWith('  $ npm test'));

const incompleteCall = callAt({ toolCallId: 'call-partial', argsComplete: false });
check('incomplete arguments stay Pi own component', !(incompleteCall instanceof PiBlockComponent));

const groupedCall = renderers.renderCall({ command: 'git status' }, theme, context({ toolCallId: 'call-group', expanded: false }));
const groupedLines = lines(groupedCall);
check('a collapsed command keeps the flush-left row', groupedLines[0].startsWith('● Running 1 command'));
check('a collapsed row starts at column zero', groupedLines[0].startsWith('●'));

closeCommandGroup();
setActiveViewMode('full');
const fullLines = lines(renderers.renderCall({ command: 'npm test' }, theme, context({ toolCallId: 'call-full' })));
check('full view leaves the block to Pi untouched', fullLines.length === 1 && fullLines[0].trim() === '$ npm test');

resetCommandGroups();
setActiveViewMode('full');

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
