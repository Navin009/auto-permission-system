import { Container, Text, visibleWidth } from '@earendil-works/pi-tui';
import { setActiveViewMode } from '../../../src/tool-view/session.ts';
import { resetCommandGroups } from '../../../src/tool-view/command-groups.ts';
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
const repaint = (expanded) => {
	const context = { ...base, expanded };

	slots.call = renderers.renderCall({ command: 'npm test' }, theme, context);
	slots.result = renderers.renderResult(RESULT, { expanded, isPartial: false }, theme, context);
};

const lines = (component) => (component?.render(WIDTH) ?? []).map((line) => line.trimEnd());
const drawnLines = () => [...lines(slots.call), ...lines(slots.result)];
const openRow = () => {
	slots.call.handleMouse(CLICK);
	repaint(false);
};

resetCommandGroups();
setActiveViewMode('compact');

const renderers = toolViewRenderers('bash', fallback);

repaint(false);
check('a collapsed row starts with our row', lines(slots.call)[0].includes('Running 1 command'));
check('the row keeps its command line', lines(slots.call)[1] === '  └ $ npm test');
check('our row paints its own mark', painted.includes('fg:success'));

painted.length = 0;
openRow();

check('the opened row draws Pi own call line', lines(slots.call).join('\n') === '$ npm test');
check('the opened row draws Pi own result', lines(slots.result).join('\n') === 'preview');
check('the opened row adds no blank line', drawnLines().every((line) => line.trim() !== ''));
check('the opened row adds no padding', drawnLines().every((line) => !line.startsWith(' ')));
check('the opened row stays inside the width', drawnLines().every((line) => visibleWidth(line) <= WIDTH));
check('the opened row never paints over Pi own view', painted.length === 0);

repaint(false);
check('Pi own call component is reused across repaints', callComponents.at(-1).wasReused === true);
check('Pi own result component is reused across repaints', resultComponents.at(-1).wasReused === true);
check('the collapsed level hands Pi a collapsed result', resultComponents.at(-1).expanded === false);
check('the opened row still shows Pi own call line', lines(slots.call).join('\n') === '$ npm test');

resetCommandGroups();
setActiveViewMode('compact');
delete state.settled;
state.piCall = undefined;
state.piResult = undefined;

repaint(false);
slots.call.handleMouse(CLICK);
repaint(false);
slots.result.handleMouse(CLICK);
repaint(false);

check('a click on Pi own block reaches the full result', resultComponents.at(-1).expanded === true);
check('the full result is Pi own text', lines(slots.result).join('\n') === 'full output');

resetCommandGroups();
setActiveViewMode('full');

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
