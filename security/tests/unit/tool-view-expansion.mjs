import { Container, Text } from '@earendil-works/pi-tui';
import { ExpansionLevel, nextExpansionLevel, resolvedExpansionLevel } from '../../../src/core/tool-view/expansion-level.ts';
import { setActiveViewMode } from '../../../src/tool-view/session.ts';
import { resetRowGroups, closeRowGroup } from '../../../src/tool-view/row-groups.ts';
import { toolViewRenderers } from '../../../src/tool-view/renderers.ts';
import { RowGroupComponent } from '../../../src/tool-view/row-group-component.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const WIDTH = 60;
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

check('a current row opens Pi collapsed view', nextExpansionLevel(ExpansionLevel.Row, false) === ExpansionLevel.Collapsed);
check('a folded row unfolds to the group view first', nextExpansionLevel(ExpansionLevel.Row, true) === ExpansionLevel.Group);
check('the group view opens Pi collapsed view', nextExpansionLevel(ExpansionLevel.Group, true) === ExpansionLevel.Collapsed);
check('a collapsed block opens Pi full view', nextExpansionLevel(ExpansionLevel.Collapsed, true) === ExpansionLevel.Full);
check('a full block returns to the row', nextExpansionLevel(ExpansionLevel.Full, true) === ExpansionLevel.Row);
check('the expand key jumps straight to the full view', resolvedExpansionLevel(ExpansionLevel.Group, true) === ExpansionLevel.Full);
check('the expand key off keeps the clicked level', resolvedExpansionLevel(ExpansionLevel.Group, false) === ExpansionLevel.Group);

const lines = (component) => component?.render(WIDTH) ?? [];
const state = {};
const slots = { call: undefined, result: undefined };

const repaint = (expanded) => {
	const context = { ...base, state, expanded };
	slots.call = renderers.renderCall({ command: 'npm test' }, theme, context);
	slots.result = renderers.renderResult(result, { expanded, isPartial: false }, theme, context);
};

const drawnText = () => [...lines(slots.call), ...lines(slots.result)].filter((line) => line.trim() !== '').join('\n');
const drawsRow = () => slots.call instanceof RowGroupComponent || slots.result instanceof RowGroupComponent;
const drawsPiView = () => !drawsRow() && drawnText().includes('preview');
const clickable = () => (slots.call?.handleMouse ? slots.call : slots.result);
const click = () => {
	const handled = clickable().handleMouse(CLICK);
	repaint(false);
	return handled;
};

resetRowGroups();
setActiveViewMode('compact');

const renderers = toolViewRenderers('bash', fallback);

repaint(false);
check('a collapsed group draws our row', drawsRow() && drawnText().includes('Running 1 command'));
check('the row names the command line', drawnText().includes('  └ $ npm test'));
check('the row never reaches Pi own result renderer', resultLevels.length === 0);

check('a left click on the row is handled', click()?.handled === true);
check('the click opens Pi own block', drawsPiView());
check('the opened row draws Pi own call', drawnText().includes('$ npm test'));
check('the block draws Pi own collapsed result', drawnText().includes('preview'));
check('the collapsed block is Pi own collapsed renderer', resultLevels.at(-1) === false);

const openedLines = lines(slots.call);
check('the open block is one frame', openedLines.length >= 3);
check('the open block carries both Pi components', openedLines.some((line) => line.includes('$ npm test')) && openedLines.some((line) => line.includes('preview')));
check('the open block leaves the result slot empty', lines(slots.result).length === 0);

check('a left click on the block is handled', click()?.handled === true);
check('the second click draws the full result', drawnText().includes('full output'));
check('the full block is Pi own expanded renderer', resultLevels.at(-1) === true);

check('a third click returns to the row', click()?.handled === true);
check('the returned row is ours again', drawsRow() && !drawnText().includes('full output'));
check('a non-click mouse event is left to Pi', clickable().handleMouse({ ...CLICK, type: 'move' }) === undefined);
check('a right click is left to Pi', clickable().handleMouse({ ...CLICK, button: 'right' }) === undefined);

repaint(true);
check('the expand key still opens Pi full view', drawnText().includes('full output'));

resetRowGroups();
repaint(false);
closeRowGroup();
repaint(false);
check('a closed group folds to one line', drawsRow() && !drawnText().includes('  └ $ npm test'));
check('the folded row carries the expand hint', drawnText().includes('ctrl+o to expand'));

check('a click on the folded row is handled', click()?.handled === true);
check('the first click draws the group command view', drawsRow() && drawnText().includes('  └ $ npm test'));
check('the group view carries no expand hint', !drawnText().includes('ctrl+o to expand'));

check('a click on the group view is handled', click()?.handled === true);
check('the second click opens Pi own collapsed block', drawsPiView() && resultLevels.at(-1) === false);

check('a click on the collapsed block is handled', click()?.handled === true);
check('the third click opens the full result', resultLevels.at(-1) === true);

check('a click on the full block is handled', click()?.handled === true);
check('the fourth click folds the row back', drawsRow() && !drawnText().includes('  └ $ npm test'));

const readFallback = {
	renderShell: 'default',
	renderCall: (args, _theme, context) => {
		const text = context.lastComponent ?? new Text('', 0, 0);
		text.setText(`read ${args.path}`);
		return text;
	},
	renderResult: (_result, options, _theme, context) => {
		const container = context.lastComponent ?? new Container();
		container.clear();
		container.addChild(new Text(options.expanded ? 'full file' : 'file preview', 0, 0));
		return container;
	},
};
const readRenderers = toolViewRenderers('read', readFallback);
const readState = {};
const readSlots = { call: undefined, result: undefined };
const repaintRead = (expanded) => {
	const context = { ...base, args: { path: 'src/a.ts' }, state: readState, expanded };
	readSlots.call = readRenderers.renderCall({ path: 'src/a.ts' }, theme, context);
	readSlots.result = readRenderers.renderResult(result, { expanded, isPartial: false }, theme, context);
};
const readText = () => [...lines(readSlots.call), ...lines(readSlots.result)].filter((line) => line.trim() !== '').join('\n');
const readClick = () => {
	const handled = (readSlots.call?.handleMouse ? readSlots.call : readSlots.result).handleMouse(CLICK);
	repaintRead(false);
	return handled;
};

resetRowGroups();
repaintRead(false);
check('a read run opens with its file lines', readText().includes('  └ src/a.ts') && !readText().includes('file preview'));

closeRowGroup();
repaintRead(false);
check('a closed read run folds to one line', !readText().includes('  └ src/a.ts') && readText().includes('(src/a.ts)'));

check('a click on the folded read row is handled', readClick()?.handled === true);
check('the first read click draws the file list, never Pi block files', readText().includes('  └ src/a.ts') && !readText().includes('file preview'));
check('the file list carries no expand hint', !readText().includes('ctrl+o to expand'));

check('a click on the read list is handled', readClick()?.handled === true);
check('the second read click opens Pi own block', readText().includes('read src/a.ts') && readText().includes('file preview'));

check('a click on the read block is handled', readClick()?.handled === true);
check('the third read click opens the full file', readText().includes('full file'));

check('a click on the full read block is handled', readClick()?.handled === true);
check('the fourth read click folds the row back', !readText().includes('  └ src/a.ts') && !readText().includes('full file'));

resetRowGroups();
setActiveViewMode('full');

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
