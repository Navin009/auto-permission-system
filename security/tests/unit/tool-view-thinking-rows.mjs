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

const WIDTH = 100;
const HINT = 'ctrl+o to expand';
const lineText = (line) =>
	`${line.indent}${line.mark ? `${line.mark.glyph} ` : ''}${line.text}${line.hint ? ` ${line.hint}` : ''}${line.duration ? ` ${line.duration}` : ''}`;
const body = (lines) => lines.slice(1).map(lineText);
const group = (group) => rowGroupLines(groupSummary(group, HINT), WIDTH);
const join = (toolCallId, target, kind = RowKind.Shell) =>
	joinRowGroup({ toolCallId, kind, target, invalidate: () => {} });
const settle = (toolCallId, target, status = ToolStatus.Ok, durationMilliseconds = 1_000, kind = RowKind.Shell) =>
	settleRowGroup({ toolCallId, kind, target, status, durationMilliseconds, invalidate: () => {} });

resetRowGroups();
resetThinking();

const running = join('call-a', 'npm test');
check('a plain row draws only the command line', body(group(running)).join('|') === '  └ $ npm test');

beginThinking();
now += 4_000;
const streaming = group(running);
check('a streaming thought adds no line of its own', body(streaming).join('|') === '  └ $ npm test');
check('a streaming thought rides in the bracket only', lineText(streaming[0]) === '● Running 1 command (thinking 4s) · 4s');

endThinking();
settle('call-a', 'npm test', ToolStatus.Ok, 4_000);
now += 1_000;
join('call-b', 'npm run build');
const twoCommands = group(running);
check('a thought between two commands leaves one group', twoCommands[0].text.startsWith('Running 2 commands'));
check('a thought between two commands draws one line per command', body(twoCommands).join('|') === '  └ ✓ $ npm test 4s|  └ … $ npm run build');

beginThinking();
now += 2_000;
const secondThought = group(running);
check('a second thought adds no line either', body(secondThought).length === 2);
check('a second thought rides on the same row', lineText(secondThought[0]).includes('(thinking 2s)'));
endThinking();

settle('call-b', 'npm run build', ToolStatus.Ok, 2_000);
const settled = group(running);
check('a settled group keeps one line per command', body(settled).join('|') === '  └ ✓ $ npm test 4s|  └ ✓ $ npm run build 2s');

const rows = groupSummary(running, HINT).rows;
check('a group holds commands only', rows.every((row) => 'target' in row && 'status' in row));
check('a thought is never counted as a row', rows.length === 2);

resetRowGroups();
const read = join('call-read', 'src/a.ts', RowKind.Read);
settle('call-read', 'src/a.ts', ToolStatus.Ok, 800, RowKind.Read);
beginThinking();
now += 1_000;
const readRow = group(read);
check('a read row takes the bracket too', lineText(readRow[0]).includes('Reading 1 file') && lineText(readRow[0]).includes('(thinking 1s)'));
check('a read row draws no line for a thought', readRow.length === 1);
endThinking();

Date.now = realNow;
resetRowGroups();
resetThinking();

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
