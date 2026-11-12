import { rowGroupLines } from '../../../src/core/tool-view/row-group.ts';
import { RowKind } from '../../../src/core/tool-view/row-kind.ts';
import { ToolStatus } from '../../../src/core/tool-view/status.ts';
import {
	groupSummary,
	joinRowGroup,
	resetRowGroups,
	settleRowGroup,
} from '../../../src/tool-view/row-groups.ts';
import { beginThinking, endThinking, resetThinking } from '../../../src/tool-view/thinking-clock.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const realNow = Date.now;
let now = 1_000_000;
Date.now = () => now;

const lineText = (line) =>
	`${line.mark ? `${line.mark.glyph} ` : ''}${line.text}${line.hint ? ` ${line.hint}` : ''}`;
const WIDTH = 100;
const header = (group) => lineText(rowGroupLines(groupSummary(group, 'ctrl+o to expand'), WIDTH)[0]);
const join = (toolCallId, target, kind = RowKind.Shell) =>
	joinRowGroup({ toolCallId, kind, target, invalidate: () => {} });
const settle = (toolCallId, target, status, durationMilliseconds, kind = RowKind.Shell) =>
	settleRowGroup({ toolCallId, kind, target, status, durationMilliseconds, invalidate: () => {} });

resetRowGroups();
const running = join('call-a', 'npm test');
check('a row starts at zero', header(running) === '● Running 1 command · 0ms');

now += 1_200;
check('a running row counts up', header(running) === '● Running 1 command · 1.2s');

now += 800;
check('a running row keeps counting', header(running) === '● Running 1 command · 2s');

beginThinking();
now += 4_000;
check('a row keeps its own count while a thought streams', header(running) === '● Running 1 command (thinking 4s) · 6s');

endThinking();
now += 5_000;
check('a running row keeps counting after the thought', header(running) === '● Running 1 command · 11s');

settle('call-a', 'npm test', ToolStatus.Ok, 5_000);
check('a finished row shows the tool duration', header(running) === '✓ Running 1 command · 5s');

now += 2_000;
check('a finished row stays frozen', header(running) === '✓ Running 1 command · 5s');

join('call-b', 'npm run build');
now += 1_000;
check('a second command keeps the group count going', header(running) === '● Running 2 commands · 8s');

settle('call-b', 'npm run build', ToolStatus.Ok, 1_000);
check('the group ends on the last settle', header(running) === '✓ Running 2 commands · 8s');

const read = join('call-read', 'src/a.ts', RowKind.Read);
now += 1_500;
check('a running read counts up', header(read) === '● Reading 1 file (src/a.ts) · 1.5s ctrl+o to expand');

settle('call-read', 'src/a.ts', ToolStatus.Ok, 1_500, RowKind.Read);
check('a finished read keeps its target', header(read) === '✓ Reading 1 file (src/a.ts) · 1.5s ctrl+o to expand');

beginThinking();
now += 3_000;
check('a settled row counts up while a thought streams', header(read) === '● Reading 1 file (src/a.ts) (thinking 3s) · 4.5s ctrl+o to expand');

endThinking();
now += 1_000;
check('the settled row freezes where the thought ended', header(read) === '✓ Reading 1 file (src/a.ts) · 4.5s ctrl+o to expand');

Date.now = realNow;
resetThinking();
resetRowGroups();

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
