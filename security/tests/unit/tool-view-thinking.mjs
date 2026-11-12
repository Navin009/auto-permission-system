import { commandGroupText, headerBody } from '../../../src/core/tool-view/command-group.ts';
import { thinkingPart } from '../../../src/core/tool-view/thinking.ts';
import { StatusMark } from '../../../src/core/tool-view/status.ts';
import {
	closeCommandGroup,
	groupSummary,
	joinCommandGroup,
	resetCommandGroups,
} from '../../../src/tool-view/command-groups.ts';
import { CommandGroupComponent } from '../../../src/tool-view/command-group-component.ts';
import { beginThinking, endThinking, resetThinking, thinkingState } from '../../../src/tool-view/thinking.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const HINT = 'ctrl+o to expand';
const command = (overrides) => ({ command: 'npm test', status: StatusMark.Ok, durationMilliseconds: 1200, ...overrides });
const state = (elapsedMilliseconds) => ({ startedAt: 1000, now: 1000 + elapsedMilliseconds });
const theme = { fg: (_name, text) => text, bold: (text) => text, bg: (_name, text) => text };
const lines = (summary, width) => new CommandGroupComponent(() => summary, theme, () => {}).render(width);
const header = (summary, width) => lines(summary, width)[0];
const group = (overrides) => commandGroupText({
	commands: [command({}), command({ command: 'npm run build' })],
	totalDurationMilliseconds: 4200,
	hint: HINT,
	thinking: undefined,
	...overrides,
});

check('thinking at the start reads zero seconds', thinkingPart(state(0)) === 'thinking… 0s');
check('thinking counts whole seconds', thinkingPart(state(3400)) === 'thinking… 3s');
check('thinking truncates a part second', thinkingPart(state(3999)) === 'thinking… 3s');
check('thinking never counts backwards', thinkingPart(state(-5000)) === 'thinking… 0s');
check('thinking survives a broken clock', thinkingPart({ startedAt: Number.NaN, now: 10 }) === 'thinking… 0s');

check('the header puts thinking before the duration', headerBody({ count: 'Running 2 commands', thinking: 'thinking… 3s', duration: '4.2s' }) === 'Running 2 commands (thinking… 3s) · 4.2s');
check('the header drops the parens without thinking', headerBody({ count: 'Running 2 commands', thinking: undefined, duration: '4.2s' }) === 'Running 2 commands · 4.2s');
check('the header drops the duration when unknown', headerBody({ count: 'Running 1 command', thinking: 'thinking… 0s', duration: undefined }) === 'Running 1 command (thinking… 0s)');

const quiet = group({});
check('a group without thinking keeps the plain body', quiet.body === 'Running 2 commands · 4.2s');
check('a group without thinking has no thinking part', quiet.thinking === undefined);
check('a group keeps its count in its own field', quiet.count === 'Running 2 commands');
check('a group carries its duration bare', quiet.duration === '4.2s');

const thinking = group({ thinking: state(3000) });
check('a thinking group puts the parens before the duration', thinking.body === 'Running 2 commands (thinking… 3s) · 4.2s');
check('thinking never changes the command count', thinking.count === 'Running 2 commands');
check('thinking never becomes a command line', thinking.commandLines.length === 2);

const summary = (overrides) => ({
	commands: [command({}), command({ command: 'npm run build' })],
	totalDurationMilliseconds: 4200,
	hint: HINT,
	thinking: state(3200),
	...overrides,
});

check('the row draws the thinking parens', header(summary(), 80).includes('(thinking… 3s)'));
check('thinking marks a settled group as running', header(summary(), 80).startsWith('●'));
check('thinking leaves a settled group open', group({ thinking: state(3000) }).status === StatusMark.Running);
check('a failure outranks thinking', group({ thinking: state(3000), commands: [command({ status: StatusMark.Failed })] }).mark === '✗');
check('the row puts thinking before the duration', header(summary(), 80).includes('(thinking… 3s) · 4.2s'));
check('the row keeps the count while thinking', header(summary(), 80).includes('● Running 2 commands'));
check('a running mark carries the parens too', header(summary({ commands: [command({ status: StatusMark.Running })] }), 80).includes('● Running 1 command (thinking… 3s)'));
check('the row drops the parens once thinking ends', !header(summary({ thinking: undefined }), 80).includes('thinking'));

const wide = header(summary(), 80);
const noHint = header(summary(), 45);
const noThinking = header(summary(), 30);
const countOnly = header(summary(), 22);

check('a wide row keeps the expand hint', wide.includes(HINT));
check('the hint is the first thing to go', !noHint.includes(HINT) && noHint.includes('(thinking… 3s)'));
check('thinking goes after the hint', !noThinking.includes('thinking') && noThinking.includes('· 4.2s'));
check('the duration goes last', countOnly.includes('Running 2 commands') && !countOnly.includes('4.2s'));
check('narrow rows still count every command', countOnly.includes('Running 2 commands'));

resetThinking();
check('no thinking is reported before it starts', thinkingState() === undefined);

beginThinking();
const started = thinkingState();
check('thinking starts at zero seconds', started !== undefined && started.now - started.startedAt < 1000);
check('a second delta does not restart the clock', (beginThinking(), thinkingState()?.startedAt === started.startedAt));

endThinking();
check('finished thinking is not reported', thinkingState() === undefined);
check('finished thinking is not reported twice', (endThinking(), thinkingState() === undefined));

resetCommandGroups();
const group1 = joinCommandGroup({ toolCallId: 'call-1', command: 'npm test', invalidate: undefined });

beginThinking();
check('the open group carries the running thought', groupSummary(group1, HINT).thinking !== undefined);

closeCommandGroup();
check('a closed group carries no thought', groupSummary(group1, HINT).thinking === undefined);

resetThinking();
resetCommandGroups();

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
