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

beginThinking();
now += 3_000;
endThinking();
now += 1_000;
const afterThought = join('call-b', 'npm run build');
check('a command after a thought does not join the row above it', afterThought !== running);
check('the row above the thought folds to one line', body(group(running)).length === 0);
check('the folded row keeps its own count', group(running)[0].text.startsWith('Running 1 command'));
check('the folded row keeps its own command', lineText(group(running)[0]).includes('(npm test)'));
check('the command after the thought opens its own row', body(group(afterThought)).join('|') === '  └ $ npm run build');

settle('call-b', 'npm run build', ToolStatus.Ok, 1_000);
const settledSecond = group(afterThought);
check('the second row counts only its own command', settledSecond[0].text.startsWith('Running 1 command'));
check('the second row draws only its own command', body(settledSecond).join('|') === '  └ $ npm run build');

const secondRows = groupSummary(afterThought, HINT).rows;
check('a group holds commands only', secondRows.every((row) => 'target' in row && 'status' in row));
check('a thought is never counted as a row', secondRows.length === 1);

resetRowGroups();
resetThinking();

beginThinking();
now += 2_000;
const firstCallAfterEarlyThought = join('call-early', 'git status');
check('a thought before the first command does not open a row by itself', body(group(firstCallAfterEarlyThought)).join('|') === '  └ $ git status');
check('the first command after a thought has no row to fold above it', group(firstCallAfterEarlyThought)[0].text.startsWith('Running 1 command'));
endThinking();

settle('call-early', 'git status', ToolStatus.Ok, 2_000);
const joinedLater = join('call-later', 'git diff');
check('commands after the first one still join their row', joinedLater === firstCallAfterEarlyThought);
check('a joined command keeps one row for the run', body(group(firstCallAfterEarlyThought)).join('|') === '  └ ✓ $ git status 2s|  └ … $ git diff');

resetRowGroups();
resetThinking();

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
