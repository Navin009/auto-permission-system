import { rowGroupLines } from '../../../src/core/tool-view/row-group.ts';
import { RowKind } from '../../../src/core/tool-view/row-kind.ts';
import { ToolStatus } from '../../../src/core/tool-view/status.ts';
import {
	drawsFrame,
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
const thoughtBetween = (seconds) => {
	beginThinking();
	now += seconds * 1_000;
	endThinking();
};

resetRowGroups();
resetThinking();

const running = join('call-a', 'npm test');
check('a row draws only its commands', body(group(running)).join('|') === '  └ $ npm test');

beginThinking();
now += 4_000;
const thinking = group(running);
check('a thought draws no line of its own inside the row', body(thinking).join('|') === '  └ $ npm test');
check('no line ever says Thinking', thinking.every((line) => !lineText(line).includes('Thinking')));
check('the bracket still rides the open row', lineText(thinking[0]) === '● Running 1 command (thinking 4s) · 4s');
endThinking();
check('the bracket leaves when the thought completes', lineText(group(running)[0]) === '● Running 1 command · 4s');

const runningSecond = join('call-b', 'npm run build');
check('a thought while a command runs never splits the row', runningSecond === running);
check('the running row keeps both commands', groupSummary(running, HINT).rows.length === 2);

settle('call-a', 'npm test', ToolStatus.Ok, 1_000);
settle('call-b', 'npm run build', ToolStatus.Ok, 1_000);
thoughtBetween(3);
const afterThought = join('call-c', 'npm run lint');
check('an uncaptured thought between commands splits safely', afterThought !== running);
check('the row above the thought folds to one line', group(running).length === 1);
check('the folded row names its last command', group(running)[0].text.includes('(npm run build)'));
check('the new row starts at the command after the thought', drawsFrame(afterThought, 'call-c') && !drawsFrame(afterThought, 'call-a'));
check('the new row counts only its own command', groupSummary(afterThought, HINT).rows.length === 1);
check('the new row draws that one command', body(group(afterThought)).join('|') === '  └ $ npm run lint');
check('a thought is never counted as a row', groupSummary(afterThought, HINT).rows.length === 1);

settle('call-c', 'npm run lint', ToolStatus.Ok, 500);
thoughtBetween(2);
check('a thought with no command after it leaves the row as it is', group(afterThought).length === 2);

resetRowGroups();
resetThinking();

const read = join('call-read', 'src/a.ts', RowKind.Read);
settle('call-read', 'src/a.ts', ToolStatus.Ok, 800, RowKind.Read);
beginThinking();
now += 1_000;
const readRow = group(read);
check('a read row takes the bracket too', lineText(readRow[0]).includes('Reading 1 file') && lineText(readRow[0]).includes('(thinking 1s)'));
check('a read row draws no thought line either', body(readRow).join('|') === '  └ src/a.ts');
endThinking();
thoughtBetween(1);
const readAfterThought = join('call-read-2', 'src/b.ts', RowKind.Read);
check('an uncaptured thought between reads splits safely', readAfterThought !== read);
check('the next read run starts at its own file', body(group(readAfterThought)).join('|') === '  └ src/b.ts');

resetRowGroups();
resetThinking();

const firstKind = join('call-shell', 'npm test', RowKind.Shell);
thoughtBetween(2);
const otherKind = join('call-other', 'src/a.ts', RowKind.Read);
check('a thought before a different kind starts its own row', otherKind !== firstKind);
check('the row above keeps its own header', lineText(group(firstKind)[0]).includes('Running 1 command'));

Date.now = realNow;
resetRowGroups();
resetThinking();

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
