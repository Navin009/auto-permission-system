import { RowKind } from '../../../src/core/tool-view/row-kind.ts';
import { ToolStatus } from '../../../src/core/tool-view/status.ts';
import {
	closeRowGroup,
	drawsFrame,
	joinRowGroup,
	resetRowGroups,
	settleRowGroup,
} from '../../../src/tool-view/row-groups.ts';
import { resetThinking } from '../../../src/tool-view/thinking-clock.ts';
import { resetThinkingVisibility } from '../../../src/tool-view/thinking-visibility.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const realNow = Date.now;
let now = 1_000_000;
Date.now = () => now;

const painted = [];
const clear = () => { painted.length = 0; };
const paint = (toolCallId) => () => painted.push(toolCallId);
const join = (toolCallId, target, kind = RowKind.Shell) =>
	joinRowGroup({ toolCallId, kind, target, invalidate: paint(toolCallId) });
const settle = (toolCallId, target, status = ToolStatus.Ok, durationMilliseconds = 1_000, kind = RowKind.Shell) =>
	settleRowGroup({ toolCallId, kind, target, status, durationMilliseconds, invalidate: paint(toolCallId) });

resetThinking();
resetThinkingVisibility();
resetRowGroups();

const first = join('a', 'ls');
check('the first command draws the frame', drawsFrame(first, 'a'));
check('the first command needs no repaint round', painted.length === 0);

clear();
join('b', 'pwd');
check('a joining command repaints the frame it joined', painted.includes('a'));
check('a joining command never draws', !drawsFrame(first, 'b'));
check('a joining command never repaints itself', !painted.includes('b'));

clear();
settle('b', 'pwd', ToolStatus.Ok, 500);
check('a later member settling repaints the drawer', painted.includes('a'));
check('the frame stays on its first command', drawsFrame(first, 'a'));

clear();
settle('a', 'ls', ToolStatus.Ok, 300);
check('the drawer settling needs no repaint round', painted.length === 0);
check('a settled drawer keeps drawing', drawsFrame(first, 'a'));

clear();
join('c', 'git status');
check('a third command repaints the drawer only', painted.join(',') === 'a');

clear();
closeRowGroup();
check('closing repaints every member once', painted.sort().join(',') === 'a,b,c');

resetRowGroups();
clear();
const run = join('x1', 'ls');
for (const toolCallId of ['x2', 'x3', 'x4']) {
	join(toolCallId, 'ls');
}
const drawers = ['x1', 'x2', 'x3', 'x4'].filter((toolCallId) => drawsFrame(run, toolCallId));
check('one mount owns a four-command frame', drawers.join(',') === 'x1');
check('the drawer was repainted once per join', painted.sort().join(',') === 'x1,x1,x1');

Date.now = realNow;
resetThinking();
resetThinkingVisibility();
resetRowGroups();

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
