import { Container, Text } from '@earendil-works/pi-tui';
import { nextExpansionLevel, ExpansionLevel, resolvedExpansionLevel } from '../../../src/core/tool-view/expansion-level.ts';
import { setActiveViewMode } from '../../../src/tool-view/session.ts';
import { resetCommandGroups } from '../../../src/tool-view/command-groups.ts';
import { toolViewRenderers } from '../../../src/tool-view/renderers.ts';
import { PiBlockComponent } from '../../../src/tool-view/pi-block.ts';
import { CommandGroupComponent } from '../../../src/tool-view/command-group-component.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const WIDTH = 40;
const CLICK = { type: 'click', button: 'left', x: 0, y: 0, width: WIDTH, height: 1, shift: false, alt: false, ctrl: false };

const theme = { fg: (name, text) => text, bold: (text) => text, bg: (name, text) => text };
const result = { content: [{ type: 'text', text: 'done' }] };
const resultLevels = [];

const fallback = {
	renderShell: 'default',
	renderCall: (args, _theme, context) => {
		const text = context.lastComponent ?? new Text('', 0, 0);
		text.setText(`$ ${args.command}`);
		return text;
	},
	renderResult: (_result, options, _theme, context) => {
		resultLevels.push(options.expanded);
		const container = context.lastComponent ?? new Container();
		container.clear();
		container.addChild(new Text(options.expanded ? 'full output' : 'preview', 0, 0));
		return container;
	},
};

const base = {
	args: { command: 'npm test' },
	toolCallId: 'call-1',
	invalidate: () => {},
	cwd: '/work/project',
	executionStarted: true,
	argsComplete: true,
	isPartial: false,
	showImages: false,
	isError: false,
	durationMs: undefined,
	outputPad: 1,
	keyText: () => 'ctrl+o',
	keyHint: () => 'ctrl+o to expand',
};

check('a row opens Pi collapsed view', nextExpansionLevel(ExpansionLevel.Row) === ExpansionLevel.Collapsed);
check('a collapsed block opens Pi full view', nextExpansionLevel(ExpansionLevel.Collapsed) === ExpansionLevel.Full);
check('a full block returns to the row', nextExpansionLevel(ExpansionLevel.Full) === ExpansionLevel.Row);
check('the expand key jumps straight to the full view', resolvedExpansionLevel(ExpansionLevel.Collapsed, true) === ExpansionLevel.Full);
check('the expand key off keeps the clicked level', resolvedExpansionLevel(ExpansionLevel.Collapsed, false) === ExpansionLevel.Collapsed);

const renderers = toolViewRenderers('bash', fallback);
const lines = (component) => component?.render(WIDTH) ?? [];
const slots = { call: undefined, result: undefined };
const state = {};

const repaint = (expanded) => {
	const context = { ...base, state, expanded };
	slots.call = renderers.renderCall({ command: 'npm test' }, theme, { ...context, lastComponent: slots.call });
	slots.result = renderers.renderResult(result, { expanded, isPartial: false }, theme, { ...context, lastComponent: slots.result });
};

const drawnText = () => [...lines(slots.call), ...lines(slots.result)].filter((line) => line.trim() !== '').join('\n');
const drawsRow = () => drawnText().includes('Running 1 command');
const drawsBlock = () => slots.call instanceof PiBlockComponent;
const clickable = () => (slots.result?.handleMouse ? slots.result : slots.call);
const click = () => {
	const handled = clickable().handleMouse(CLICK);
	repaint(false);
	return handled;
};

resetCommandGroups();
setActiveViewMode('compact');

repaint(false);
check('a collapsed group draws our row', slots.call instanceof CommandGroupComponent && drawsRow());
check('the row names the command', drawnText().includes('Running 1 command'));
check('the row never reaches Pi own result renderer', resultLevels.length === 0);

check('a left click on the row is handled', click()?.handled === true);
check('the click opens Pi own block', drawsBlock());
check('the block draws Pi own collapsed result', drawnText().includes('preview'));
check('the collapsed block is Pi own collapsed renderer', resultLevels.at(-1) === false);

check('a left click on the block is handled', click()?.handled === true);
check('the second click draws the full result', drawnText().includes('full output'));
check('the full block is Pi own expanded renderer', resultLevels.at(-1) === true);

check('a third click returns to the row', click()?.handled === true);
check('the returned row is ours again', !drawsBlock() && drawsRow());
check('a non-click mouse event is left to Pi', clickable().handleMouse({ ...CLICK, type: 'move' }) === undefined);
check('a right click is left to Pi', clickable().handleMouse({ ...CLICK, button: 'right' }) === undefined);

repaint(true);
check('the expand key still opens Pi full view', drawnText().includes('full output'));

resetCommandGroups();
setActiveViewMode('full');

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
