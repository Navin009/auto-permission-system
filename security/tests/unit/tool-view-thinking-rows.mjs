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
import { beginThinking, endThinking, resetThinking, toggleThoughtExpansion } from '../../../src/tool-view/thinking-clock.ts';
import {
	noteThinkingRendered,
	resetThinkingVisibility,
} from '../../../src/tool-view/thinking-visibility.ts';

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
resetThinkingVisibility();

const running = join('call-a', 'npm test');
check('a plain row draws only the command line', body(group(running)).join('|') === '  └ $ npm test');

beginThinking('reading the row code');
now += 4_000;
const streaming = group(running);
check('a streaming thought adds a line at the bottom', body(streaming).join('|') === '  └ $ npm test|  Thinking...');
check('the thought line is styled like Pi and has no mark or prompt', streaming[2].isThought === true && !streaming[2].isDim && streaming[2].mark === undefined && !streaming[2].text.includes('$'));
check('a streaming thought keeps the header bracket', lineText(streaming[0]) === '● Running 1 command (thinking 4s) · 4s');
check('the thought line carries the thought text, collapsed to one line', streaming[2].thoughtText === 'reading the row code');
check('a fresh thought line starts collapsed', streaming[2].thoughtExpanded === false);
toggleThoughtExpansion();
check('a thought line expands on its own', group(running)[2].thoughtExpanded === true);
toggleThoughtExpansion();
check('a second click collapses it again', group(running)[2].thoughtExpanded === false);

endThinking();
const dropped = group(running);
check('a completed thought leaves no line behind', body(dropped).join('|') === '  └ $ npm test');
check('a completed thought drops the header bracket', lineText(dropped[0]) === '● Running 1 command · 4s');

settle('call-a', 'npm test', ToolStatus.Ok, 4_000);
beginThinking();
now += 3_000;
endThinking();
now += 1_000;
const afterThought = join('call-b', 'npm run build');
check('a command after a thought joins the same row', afterThought === running);
check('a command after a thought adds one command line and no thought line', body(group(running)).join('|') === '  └ ✓ $ npm test 4s|  └ … $ npm run build');
check('the row stays on its first command', drawsFrame(running, 'call-a') && !drawsFrame(running, 'call-b'));
check('a thought is never counted as a row', groupSummary(running, HINT).rows.length === 2);

settle('call-b', 'npm run build', ToolStatus.Ok, 1_000);
check('the thought leaves no child line once everything settles', body(group(running)).join('|') === '  └ ✓ $ npm test 4s|  └ ✓ $ npm run build 1s');

resetRowGroups();
resetThinking();

const merged = join('call-merge', 'npm test');
settle('call-merge', 'npm test', ToolStatus.Ok, 2_000);
beginThinking('a thought that a command later interrupts');
check('the line shows while the thought streams alone', body(group(merged)).join('|') === '  └ $ npm test|  Thinking...');
toggleThoughtExpansion();
const next = join('call-merge-next', 'npm run build');
check('a command joining the row hides the thought line', body(group(next)).join('|') === '  └ ✓ $ npm test 2s|  └ … $ npm run build');
check('hiding drops the expansion too', group(next).at(-1).thoughtExpanded === undefined);
check('the bracket keeps the row running while the thought streams', lineText(group(next)[0]).includes('(thinking 0s)'));
endThinking();
beginThinking('the next thought');
check('the next thought brings the line back', body(group(next)).join('|') === '  └ ✓ $ npm test 2s|  └ … $ npm run build|  Thinking...');
check('the next thought comes back collapsed', group(next).at(-1).thoughtExpanded === false);
endThinking();

resetRowGroups();
resetThinking();

const read = join('call-read', 'src/a.ts', RowKind.Read);
settle('call-read', 'src/a.ts', ToolStatus.Ok, 800, RowKind.Read);
beginThinking();
now += 1_000;
const readRow = group(read);
check('a read row takes the bracket too', lineText(readRow[0]).includes('Reading 1 file') && lineText(readRow[0]).includes('(thinking 1s)'));
check(
	'a streaming thought adds one line under the read run',
	body(readRow).join('|') === '  └ src/a.ts|  Thinking...',
);endThinking();

resetRowGroups();
resetThinking();
resetThinkingVisibility();
noteThinkingRendered();

const visibleFirst = join('visible-a', 'npm test');
beginThinking();
now += 2_000;
check('no thought line is drawn when pi draws the thought itself', body(group(visibleFirst)).join('|') === '  └ $ npm test');
check('the bracket still rides the row in the visible regime', lineText(group(visibleFirst)[0]).includes('(thinking 2s)'));
endThinking();

Date.now = realNow;
resetThinking();
resetThinkingVisibility();
resetRowGroups();

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
