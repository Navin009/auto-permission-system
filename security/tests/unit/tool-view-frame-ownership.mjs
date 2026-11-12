import { RowKind } from '../../../src/core/tool-view/row-kind.ts';
import { ToolStatus } from '../../../src/core/tool-view/status.ts';
import {
	closeRowGroup,
	drawsFrame,
	joinRowGroup,
	memberIndexOf,
	resetRowGroups,
	settleRowGroup,
} from '../../../src/tool-view/row-groups.ts';
import { resetThinking } from '../../../src/tool-view/thinking-clock.ts';

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
resetRowGroups();

const run = join('a', 'ls');
check('the first member owns the header slot', drawsFrame(run, 'a'));
check('every member knows its own slot', ['a', 'b', 'c'].map(() => memberIndexOf(run, 'a')).every((index) => index === 0));

clear();
join('b', 'pwd');
check('a joining command repaints the header', painted.includes('a'));
check('a joining command never repaints itself', !painted.includes('b'));
check('the second command is its own slot', memberIndexOf(run, 'b') === 1);
check('the header never moves to the newest command', drawsFrame(run, 'a'));

clear();
settle('b', 'pwd', ToolStatus.Ok, 500);
check('a later member settling repaints the header', painted.includes('a'));
check('the header stays on the first command', drawsFrame(run, 'a'));

clear();
settle('a', 'ls', ToolStatus.Ok, 300);
check('the header member settling needs no repaint round', painted.length === 0);
check('a settled header keeps its slot', drawsFrame(run, 'a'));

clear();
join('c', 'git status');
check('a third command repaints the header only', painted.join(',') === 'a');
check('the third command takes the third slot', memberIndexOf(run, 'c') === 2);

clear();
closeRowGroup();
check('closing repaints every member once', painted.sort().join(',') === 'a,b,c');

resetRowGroups();
clear();
const longRun = join('x1', 'ls');
for (const toolCallId of ['x2', 'x3', 'x4']) {
	join(toolCallId, 'ls');
}
check('slots follow the join order', ['x1', 'x2', 'x3', 'x4'].map((id) => memberIndexOf(longRun, id)).join(',') === '0,1,2,3');
check('only the first slot draws the header', ['x2', 'x3', 'x4'].every((id) => !drawsFrame(longRun, id)));
check('the header was repainted once per join', painted.sort().join(',') === 'x1,x1,x1');

Date.now = realNow;
resetThinking();
resetRowGroups();

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
