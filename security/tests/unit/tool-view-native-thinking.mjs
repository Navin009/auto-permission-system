import { AssistantMessageComponent, initTheme } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { ExpansionLevel } from '../../../src/core/tool-view/expansion-level.ts';
import { RowKind } from '../../../src/core/tool-view/row-kind.ts';
import { ToolStatus } from '../../../src/core/tool-view/status.ts';
import {
	installNativeThinkingCapture,
	resetNativeThinking,
} from '../../../src/tool-view/native-thinking.ts';
import { setActiveViewMode } from '../../../src/tool-view/session.ts';
import {
	advanceGroupExpansion,
	closeRowGroup,
	joinRowGroup,
	nativeThoughtsForCall,
	resetRowGroups,
	settleRowGroup,
} from '../../../src/tool-view/row-groups.ts';
import { toolViewRenderers } from '../../../src/tool-view/renderers.ts';
import {
	beginThinking,
	endThinking,
	resetThinking,
} from '../../../src/tool-view/thinking-clock.ts';

let pass = 0;
let fail = 0;

const WIDTH = 100;
const NATIVE_LABEL = 'Thinking...';
const OSC_ZONE_PATTERN = /\x1b\]133;[ABC]\x07/g;
const printableText = (line) => line.replace(OSC_ZONE_PATTERN, '').trim();

const joinCommand = (toolCallId, target, kind = RowKind.Shell) =>
	joinRowGroup({ toolCallId, kind, target, invalidate: () => {} });

const settleCommand = (toolCallId, target, kind = RowKind.Shell) =>
	settleRowGroup({
		toolCallId,
		kind,
		target,
		status: ToolStatus.Ok,
		durationMilliseconds: 100,
		invalidate: () => {},
	});

const hasText = (component, text) =>
	component.render(WIDTH).some((line) => line.includes(text));

const noRendering = (component) =>
	component.render(WIDTH).every((line) => !line.trim());

const thoughtsAfter = (group, toolCallId) => nativeThoughtsForCall(group, toolCallId);

const clickOn = (component, text) => {
	const lines = component.render(WIDTH);
	const y = lines.findIndex((line) => line.includes(text));

	return component.handleMouse?.({
		type: 'click',
		button: 'left',
		x: 2,
		y,
		width: WIDTH,
		height: lines.length,
		shift: false,
		alt: false,
		ctrl: false,
	});
};

const thought = (text, hidden = true) => {
	const message = {
		role: 'assistant',
		content: [{ type: 'thinking', thinking: text }],
		stopReason: 'stop',
	};
	const component = new AssistantMessageComponent(message, hidden);

	component.updateContent(message, true);
	beginThinking(message);
	endThinking();

	return component;
};

const reset = () => {
	resetNativeThinking();
	resetRowGroups();
	resetThinking();
};

const check = (name, condition) => {
	if (condition) {
		pass++;
		return;
	}

	fail++;
	console.log('FAIL:', name, '→', JSON.stringify(condition));
};

const testSingleThoughtLifecycle = () => {
	reset();
	joinCommand('a', 'ls');
	settleCommand('a', 'ls');

	const original = thought('choose the next command');
	check('Pi native thinking is visible before another command', hasText(original, NATIVE_LABEL));

	const group = joinCommand('b', 'pwd');
	check('a captured thought no longer splits the group', group.members.length === 2);
	check('suppression removes every original native line', noRendering(original));
	check('the thought belongs to the preceding command', thoughtsAfter(group, 'a').length === 1);
	check('the new command owns no thought', thoughtsAfter(group, 'b').length === 0);

	const saved = thoughtsAfter(group, 'a')[0];
	check('the saved thought initially looks like native Pi', hasText(saved, NATIVE_LABEL));
	check(
		'the saved native thought accepts its click',
		clickOn(saved, NATIVE_LABEL)?.handled === true,
	);
	check('the click reveals real thought text', hasText(saved, 'choose the next command'));
	check('opening a thought does not advance the group', group.expansionLevel === ExpansionLevel.Row);

	clickOn(saved, 'choose the next command');
	check('a second native click returns to the native label', hasText(saved, NATIVE_LABEL));

	settleCommand('b', 'pwd');
	closeRowGroup();
	const finalThought = thought('thought before the response');
	const afterText = joinCommand('after-text', 'git log');

	check('text boundaries still prevent a joined group', afterText !== group);
	check('a thought before text stays in the transcript', hasText(finalThought, NATIVE_LABEL));
};

const testMultipleThoughtsAndRunningCalls = () => {
	reset();
	const group = joinCommand('multi-a', 'ls');
	settleCommand('multi-a', 'ls');
	thought('one interval');
	thought('another interval before the same call');
	joinCommand('multi-b', 'pwd');

	check('several thoughts still leave one group', group.members.length === 2);
	check('both thoughts follow the preceding command', thoughtsAfter(group, 'multi-a').length === 2);

	reset();
	const readGroup = joinCommand('read-a', 'src/a.ts', RowKind.Read);
	settleCommand('read-a', 'src/a.ts', RowKind.Read);
	thought('a thought between reads');
	joinCommand('read-b', 'src/b.ts', RowKind.Read);

	check('two reads join across a captured thought', readGroup.members.length === 2);
	check('a read run retains its native thought', thoughtsAfter(readGroup, 'read-a').length === 1);

	reset();
	const runningGroup = joinCommand('running-a', 'npm test');
	const runningThought = thought('thought while running');
	joinCommand('running-b', 'npm run build');
	joinCommand('running-c', 'npm run lint');

	check(
		'a thought never hides a running command',
		hasText(runningThought, NATIVE_LABEL),
	);
	check('the running group still takes its commands', runningGroup.members.length === 3);
	check(
		'the running thought was not moved into expansion',
		thoughtsAfter(runningGroup, 'running-a').length === 0,
	);
};

const testSafeFallback = () => {
	reset();
	joinCommand('fallback-a', 'ls');
	settleCommand('fallback-a', 'ls');
	beginThinking();
	endThinking();
	const fallback = joinCommand('fallback-b', 'pwd');

	check(
		'an uncaptured thought keeps the safe split',
		fallback.members[0].toolCallId === 'fallback-b',
	);

	reset();
	joinCommand('failure-a', 'ls');
	settleCommand('failure-a', 'ls');
	const incompatible = thought('native internals changed', false);
	Object.defineProperty(incompatible, 'hideThinkingBlock', { get: () => false, set: () => {} });
	const failedSuppression = joinCommand('failure-b', 'pwd');

	check(
		'nonzero suppression falls back to a new group',
		failedSuppression.members[0].toolCallId === 'failure-b',
	);
	check(
		'a failed suppression leaves the native thought visible',
		hasText(incompatible, 'native internals changed'),
	);
};

const testCustomNativeLabel = () => {
	reset();
	joinCommand('custom-a', 'ls');
	settleCommand('custom-a', 'ls');
	const original = thought('a custom native label');
	original.setHiddenThinkingLabel('Reasoning...');
	const group = joinCommand('custom-b', 'pwd');
	const saved = thoughtsAfter(group, 'custom-a')[0];

	check('suppression preserves custom live labels', noRendering(original));
	check('the expansion preserves the captured native label', hasText(saved, 'Reasoning...'));
	clickOn(saved, 'Reasoning...');
	check('a custom native label opens the thought too', hasText(saved, 'a custom native label'));
};

const paintNativeGroup = (group) => {
	const fallback = {
		renderCall: (args) => new Text(`bash ${args.command}`, 0, 0),
		renderResult: (_result, options) => {
			const text = options.expanded ? 'full output' : 'preview output';
			return new Text(text, 0, 0);
		},
	};
	const renderers = toolViewRenderers('bash', fallback);
	const theme = { fg: (_colour, text) => text, bg: (_colour, text) => text };
	const members = group.members.map((member) => {
		const context = {
			args: { command: member.target },
			toolCallId: member.toolCallId,
			state: { settled: true },
			argsComplete: true,
			expanded: false,
			isPartial: false,
			isError: false,
			outputPad: 1,
			invalidate: () => {},
			keyHint: () => 'ctrl+o to expand',
			keyText: () => 'ctrl+o',
		};
		const call = renderers.renderCall({ command: member.target }, theme, context);
		const result = renderers.renderResult(
			{ content: [{ type: 'text', text: 'done' }] },
			{ expanded: false, isPartial: false },
			theme,
			context,
		);

		return { call, result };
	});

	return members;
};

const testNativeExpansionAndRestoration = () => {
	reset();
	joinCommand('native-a', 'ls');
	settleCommand('native-a', 'ls');
	const text = 'native thought inside group expansion';
	const originallyVisible = thought(text, false);

	check('visible native thinking is untouched while active', hasText(originallyVisible, text));

	const nativeGroup = joinCommand('native-b', 'pwd');
	settleCommand('native-b', 'pwd');
	closeRowGroup();
	advanceGroupExpansion(nativeGroup);
	advanceGroupExpansion(nativeGroup);

	check(
		'two clicks expose the native Pi view',
		nativeGroup.expansionLevel === ExpansionLevel.Collapsed,
	);

	const [first] = paintNativeGroup(nativeGroup);
	const lines = first.call.render(WIDTH);
	const outputIndex = lines.findIndex((line) => line.includes('preview output'));
	const thoughtIndex = lines.findIndex((line) => line.includes(NATIVE_LABEL));

	check('the native Pi result precedes its thought', outputIndex >= 0 && thoughtIndex > outputIndex);
	check('the native result slot stays empty', noRendering(first.result));
	check(
		'native Pi keeps a blank line before its thought',
		printableText(lines[thoughtIndex - 1]) === '',
	);

	const click = clickOn(first.call, NATIVE_LABEL);
	check('the group click opens the thought, not the rung', click?.handled === true);
	check(
		'the group rung stays native-collapsed',
		nativeGroup.expansionLevel === ExpansionLevel.Collapsed,
	);
	check('the native group shows the expanded thought', hasText(first.call, text));

	resetNativeThinking();
	check('reset restores the original visible thought', hasText(originallyVisible, text));
	resetRowGroups();
	resetThinking();
};

initTheme(undefined, false);
installNativeThinkingCapture();
setActiveViewMode('compact');
testSingleThoughtLifecycle();
testMultipleThoughtsAndRunningCalls();
testSafeFallback();
testCustomNativeLabel();
testNativeExpansionAndRestoration();
setActiveViewMode('full');

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
