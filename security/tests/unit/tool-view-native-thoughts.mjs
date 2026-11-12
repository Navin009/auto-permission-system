import { Text } from '@earendil-works/pi-tui';
import { RowKind } from '../../../src/core/tool-view/row-kind.ts';
import { ToolStatus } from '../../../src/core/tool-view/status.ts';
import { nativeThoughtForCall } from '../../../src/tool-view/native-thought.ts';
import { setActiveViewMode } from '../../../src/tool-view/session.ts';
import {
	advanceGroupExpansion,
	joinRowGroup,
	resetRowGroups,
	settleRowGroup,
} from '../../../src/tool-view/row-groups.ts';
import { toolViewRenderers } from '../../../src/tool-view/renderers.ts';
import {
	rememberAssistantMessage,
	resetThoughts,
	thoughtForCall,
} from '../../../src/tool-view/thought-store.ts';

let pass = 0;
let fail = 0;

const check = (name, condition) => {
	if (condition) {
		pass++;
		return;
	}

	fail++;
	console.log('FAIL:', name, '→', JSON.stringify(condition));
};

const WIDTH = 90;
const message = (thinking, callId, extra = []) => ({
	role: 'assistant',
	content: [
		{ type: 'thinking', thinking },
		...extra,
		{ type: 'toolCall', id: callId, name: 'bash', arguments: { command: 'ls' } },
	],
	stopReason: 'toolUse',
});
const plain = (component) =>
	component
		.render(WIDTH)
		.map((line) => line.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\]133;[ABC]\x07/g, '').trimEnd())
		.filter((line) => line.trim().length > 0);

resetThoughts();
rememberAssistantMessage(message('I should read the plan doc first.', 'call-thought'));
rememberAssistantMessage({ role: 'assistant', content: [{ type: 'text', text: 'no thought here' }] });
rememberAssistantMessage({ role: 'user', content: [{ type: 'thinking', thinking: 'not mine' }] });
rememberAssistantMessage({ role: 'assistant', content: 'plain string' });

const stored = thoughtForCall('call-thought');
check('a thought is stored for its tool call', stored !== undefined);
check('only thinking blocks are kept', stored.content.length === 1 && stored.content[0].type === 'thinking');
check('a message without thinking is ignored', thoughtForCall('call-plain') === undefined);
check('an unknown call has no thought', thoughtForCall('call-unknown') === undefined);

const rendered = nativeThoughtForCall('call-thought');
check('a stored thought renders as a Pi component', plain(rendered).join(' ').includes('read the plan doc'));
check('an unknown call renders nothing', nativeThoughtForCall('call-unknown') === undefined);

resetThoughts();
check('a reset forgets every thought', thoughtForCall('call-thought') === undefined);

resetThoughts();
const theme = { fg: (_colour, text) => text, bg: (_colour, text) => text, bold: (text) => text };
const fallback = {
	renderShell: 'default',
	renderCall: (args) => new Text(`PI-CALL ${args.command}`, 0, 0),
	renderResult: () => new Text('PI-RESULT', 0, 0),
};
const renderers = toolViewRenderers('bash', fallback);
const state = {};
const context = {
	args: { command: 'head -150' },
	toolCallId: 'call-row',
	state,
	cwd: '/w',
	executionStarted: true,
	argsComplete: true,
	isPartial: false,
	expanded: false,
	showImages: false,
	isError: false,
	durationMs: 900,
	outputPad: 1,
	invalidate: () => {},
	keyText: () => 'ctrl+o',
	keyHint: () => 'ctrl+o to expand',
};

setActiveViewMode('compact');
resetRowGroups();
rememberAssistantMessage(message('Hidden while the row is compact.', 'call-row'));
const group = joinRowGroup({ toolCallId: 'call-row', kind: RowKind.Shell, target: 'head -150', invalidate: () => {} });

settleRowGroup({
	toolCallId: 'call-row',
	kind: RowKind.Shell,
	target: 'head -150',
	status: ToolStatus.Ok,
	durationMilliseconds: 900,
	invalidate: () => {},
});

const paint = () => {
	const call = renderers.renderCall(context.args, theme, context);
	const result = renderers.renderResult(
		{ content: [{ type: 'text', text: 'ok' }] },
		{ expanded: context.expanded, isPartial: false },
		theme,
		context,
	);

	return [...plain(call), ...plain(result)];
};

const compactLines = paint();
check('the compact row draws no thought', !compactLines.join(' ').includes('Hidden while'));
check('the compact row still draws its command', compactLines.join(' ').includes('Running 1 command'));

advanceGroupExpansion(group);
const piLines = paint();
check('the Pi view shows the thought', piLines.join(' ').includes('Hidden while the row is compact.'));
check(
	'the thought comes before the call block',
	piLines.findIndex((line) => line.includes('Hidden while')) <
		piLines.findIndex((line) => line.includes('PI-CALL')),
);
check(
	'the Pi view keeps Pi own call and result',
	piLines.join(' ').includes('PI-CALL head -150') && piLines.join(' ').includes('PI-RESULT'),
);

check('the Pi view is one component tree', typeof renderers.renderCall(context.args, theme, context).render === 'function');

resetRowGroups();
resetThoughts();
setActiveViewMode('full');

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
