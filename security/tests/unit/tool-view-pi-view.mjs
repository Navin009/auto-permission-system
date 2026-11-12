import { Container, Text, visibleWidth } from '@earendil-works/pi-tui';
import { setActiveViewMode } from '../../../src/tool-view/session.ts';
import { resetRowGroups } from '../../../src/tool-view/row-groups.ts';
import { toolViewRenderers } from '../../../src/tool-view/renderers.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const WIDTH = 60;
const CLICK = { type: 'click', button: 'left', x: 0, y: 0, width: WIDTH, height: 1, shift: false, alt: false, ctrl: false };
const RESULT = { content: [{ type: 'text', text: 'done' }] };

const painted = [];
const theme = {
	fg: (name, text) => { painted.push(`fg:${name}`); return text; },
	bold: (text) => text,
	bg: (name, text) => { painted.push(`bg:${name}`); return text; },
};

const callComponents = [];
const resultComponents = [];

const fallback = {
	renderShell: 'default',
	renderCall: (args, _theme, context) => {
		const text = context.lastComponent ?? new Text('', 0, 0);
		text.setText(`$ ${args.command}`);
		callComponents.push({ text, wasReused: context.lastComponent === text });
		return text;
	},
	renderResult: (_result, options, _theme, context) => {
		const container = context.lastComponent ?? new Container();
		container.clear();
		container.addChild(new Text(options.expanded ? 'full output' : 'preview', 0, 0));
		resultComponents.push({ container, wasReused: context.lastComponent === container, expanded: options.expanded });
		return container;
	},
};

const state = {};
const base = {
	args: { command: 'npm test' },
	toolCallId: 'call-1',
	invalidate: () => {},
	state,
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

const slots = { call: undefined, result: undefined };
const repaint = (expanded, overrides = {}) => {
	const context = { ...base, expanded, ...overrides };

	slots.call = renderers.renderCall({ command: 'npm test' }, theme, context);
	slots.result = renderers.renderResult(RESULT, { expanded, isPartial: false }, theme, context);
};

const lines = (component) => (component?.render(WIDTH) ?? []);
const trimmed = (component) => lines(component).map((line) => line.trimEnd());
const openRow = () => {
	slots.call.handleMouse(CLICK);
	repaint(false);
};

resetRowGroups();
setActiveViewMode('compact');

const renderers = toolViewRenderers('bash', fallback);

repaint(false);
check('a collapsed row starts with our row', trimmed(slots.call)[0].includes('Running 1 command'));
check('the row keeps its command line', trimmed(slots.call)[1] === '  └ $ npm test');
check('our row paints its own mark', painted.includes('fg:success'));

painted.length = 0;
openRow();

const block = trimmed(slots.call);
check('the opened row draws Pi own call line', block[1].trimStart().startsWith('$ npm test'));
check('the opened row draws Pi own result', block.some((line) => line.trim() === 'preview'));
check('Pi own components sit in one frame', block.some((line) => line.includes('$ npm test')) && block.some((line) => line.trim() === 'preview'));
check('the frame pads every line to the width', lines(slots.call).every((line) => visibleWidth(line) === WIDTH));
check('the frame keeps one blank line above', block[0] === '');
check('the frame keeps one blank line below', block.at(-1) === '');
check('the frame pads its content by one column', lines(slots.call).filter((line) => line.trim() !== '').every((line) => line.startsWith(' ')));
check('the frame paints Pi success background', painted.includes('bg:toolSuccessBg'));
check('the result slot adds no second frame', lines(slots.result).length === 0);
check('the frame never paints over Pi own view', !painted.some((name) => name.startsWith('fg:')));

painted.length = 0;
repaint(false, { isPartial: true, isError: false });
lines(slots.call);
check('a running block paints the pending background', painted.includes('bg:toolPendingBg'));
painted.length = 0;
repaint(false, { isPartial: false, isError: true });
lines(slots.call);
check('a failed block paints the error background', painted.includes('bg:toolErrorBg'));

painted.length = 0;
repaint(false);
check('Pi own call component is reused across repaints', callComponents.at(-1).wasReused === true);
check('Pi own result component is reused across repaints', resultComponents.at(-1).wasReused === true);
check('the collapsed level hands Pi a collapsed result', resultComponents.at(-1).expanded === false);
check('the opened row still shows Pi own call line', trimmed(slots.call)[1].trimStart().startsWith('$ npm test'));
check('the frame never repaints Pi own foreground colors', !painted.some((name) => name.startsWith('fg:')));

resetRowGroups();
delete state.settled;
state.piCall = undefined;
state.piResult = undefined;
state.nativeBlock = undefined;

repaint(false);
slots.call.handleMouse(CLICK);
repaint(false);
slots.call.handleMouse(CLICK);
repaint(false);

check('a click on Pi own block reaches the full result', resultComponents.at(-1).expanded === true);
check('the full result is Pi own text', lines(slots.call).some((line) => line.trim() === 'full output'));

resetRowGroups();
setActiveViewMode('full');

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
