import { rowGroupLines, pluralize } from '../../../src/core/tool-view/row-group.ts';
import { formatCommandDuration } from '../../../src/core/tool-view/duration.ts';
import { RowKind } from '../../../src/core/tool-view/row-kind.ts';
import { ToolStatus } from '../../../src/core/tool-view/status.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const HINT = 'ctrl+o to expand';
const lineText = (line) => `${line.indent}${line.mark ? `${line.mark.glyph} ` : ''}${line.text}${line.hint ? ` ${line.hint}` : ''}`;
const row = (overrides) => ({ target: 'npm test', status: ToolStatus.Ok, durationMilliseconds: 1200, ...overrides });
const summary = (rows, overrides) => ({
	kind: RowKind.Shell,
	rows,
	durationMilliseconds: 5000,
	folded: false,
	hint: HINT,
	thinking: undefined,
	...overrides,
});
const group = (rows, overrides) => rowGroupLines(summary(rows, overrides));
const readGroup = (rows, overrides) => group(rows, { kind: RowKind.Read, ...overrides });
const header = (lines) => lineText(lines[0]);
const body = (lines) => lines.slice(1).map(lineText);
const thinking = (elapsedMilliseconds) => ({ startedAt: 1000, now: 1000 + elapsedMilliseconds });

check('formatCommandDuration: under a second', formatCommandDuration(320) === '320ms');
check('formatCommandDuration: round milliseconds', formatCommandDuration(999.6) === '1000ms');
check('formatCommandDuration: tenths of a second', formatCommandDuration(1200) === '1.2s');
check('formatCommandDuration: whole seconds', formatCommandDuration(12_400) === '12s');
check('formatCommandDuration: negative clamps to zero', formatCommandDuration(-90) === '0ms');
check('formatCommandDuration: not a number clamps to zero', formatCommandDuration(Number.NaN) === '0ms');

check('a count of one stays singular', pluralize('command', 1) === 'command');
check('more than one is plural', pluralize('command', 2) === 'commands');
check('a noun ending in y takes ies', pluralize('entry', 3) === 'entries');

const one = group([row({})]);
check('one command header', header(one) === '✓ Running 1 command · 5s');
check('one command keeps a plain command line', body(one)[0] === '  └ $ npm test');
check('one open row carries no expand hint', one[0].hint === undefined);
check('one command has no overflow line', one.length === 2);

const two = group([row({}), row({ target: 'npm run build', status: ToolStatus.Running })]);
check('two commands are counted', two[0].text === 'Running 2 commands · 5s');
check('a finished command line carries its mark and duration', body(two)[0] === '  └ ✓ $ npm test 1.2s');
check('a running command line reads with an ellipsis and no duration', body(two)[1] === '  └ … $ npm run build');
check('several open commands carry no expand hint', two[0].hint === undefined);
check('a running group header stays open', two[0].mark.glyph === '●');
check('a running group is running', two[0].mark.status === ToolStatus.Running);

const failedLast = group([row({}), row({ status: ToolStatus.Failed })]);
check('the row takes the last command mark', failedLast[0].mark.glyph === '✗');
check('an earlier failure keeps its own line', body(failedLast)[0] === '  └ ✓ $ npm test 1.2s');
check('the last failure keeps its own line', body(failedLast)[1] === '  └ ✗ $ npm test 1.2s');

const failedFirst = group([row({ status: ToolStatus.Failed }), row({})]);
check('an earlier failure never turns the row red', failedFirst[0].mark.glyph === '✓');
check('a failure is never hidden by an ok neighbour', body(failedFirst)[0] === '  └ ✗ $ npm test 1.2s');

const blockedLine = group([row({}), row({ status: ToolStatus.Blocked })]);
check('a blocked line names its gate', body(blockedLine)[1] === '  └ ✗ $ npm test 1.2s blocked');

const deniedLine = group([row({}), row({ status: ToolStatus.Denied })]);
check('a denied line names its gate', body(deniedLine)[1] === '  └ ✗ $ npm test 1.2s denied');

const singleDenied = group([row({ status: ToolStatus.Denied })]);
check('a single denied row names its gate on the header', header(singleDenied) === '✗ Running 1 command · 5s denied');

const foldedSingle = group([row({})], { folded: true });
check('a folded single command is one line', foldedSingle.length === 1);
check('a folded row names the last command', header(foldedSingle) === '✓ Running 1 command (npm test) · 5s ctrl+o to expand');

const foldedGroup = group([row({}), row({ target: 'npm run build' }), row({ target: 'git status' })], { folded: true });
check('a folded group is one line', foldedGroup.length === 1);
check('a folded group names the last command', header(foldedGroup) === '✓ Running 3 commands (git status) · 5s ctrl+o to expand');

const foldedDenied = group([row({ status: ToolStatus.Denied })], { folded: true });
check('a folded denial stays named', header(foldedDenied) === '✗ Running 1 command (npm test) · 5s denied ctrl+o to expand');

const many = Array.from({ length: 11 }, (_, index) => row({ target: `cmd-${index}` }));
const window = group(many);
check('the header counts every command', window[0].text === 'Running 11 commands · 5s');
check('only the newest eight command lines are drawn', body(window).length === 9);
check('older commands collapse to one line', body(window)[0] === '  └ ... (3 earlier calls)');
check('the newest command is last', body(window).at(-1) === '  └ ✓ $ cmd-10 1.2s');
check('an eight-command group needs no overflow line', body(group(many.slice(0, 8)))[0] === '  └ ✓ $ cmd-0 1.2s');
check('the overflow line pluralizes for one hidden command', body(group(many.slice(0, 9)))[0] === '  └ ... (1 earlier call)');

check('a command without a duration drops the segment', body(group([row({}), row({ target: 'git status', durationMilliseconds: undefined })]))[1] === '  └ ✓ $ git status');
check('a command may span lines and stays one row', body(group([row({ target: 'npm test\nrm -rf /' })]))[0] === '  └ $ npm test rm -rf /');
check('a folded target never spans lines', group([row({ target: 'git\nstatus' })], { folded: true })[0].text.includes('(git status)'));

const oneRead = readGroup([row({ target: 'src/a.ts' })]);
check('one read is a single row', oneRead.length === 1);
check('a read row reads a file', header(oneRead) === '✓ Reading 1 file (src/a.ts) · 5s ctrl+o to expand');
check('a read row carries the expand hint while it is newest', oneRead[0].hint === HINT);

const threeReads = readGroup([row({ target: 'src/a.ts' }), row({ target: 'src/b.ts' }), row({ target: 'src/c.ts' })]);
check('reads are counted as files', threeReads.length === 1 && header(threeReads) === '✓ Reading 3 files (src/c.ts) · 5s ctrl+o to expand');
check('a read row never draws command lines', body(threeReads).length === 0);

const failedRead = readGroup([row({ status: ToolStatus.Blocked, durationMilliseconds: undefined })]);
check('a blocked read says so on its row', header(failedRead) === '✗ Reading 1 file (npm test) · 5s blocked ctrl+o to expand');
check('a blocked read needs no child line', failedRead.length === 1);

const shellWithRead = group([row({})], { kind: RowKind.Shell });
check('a shell row keeps its prompt', body(shellWithRead)[0] === '  └ $ npm test');

const thinkingGroup = group([row({}), row({ target: 'npm run build' })], { thinking: thinking(3000) });
check('a thought rides after the row duration', header(thinkingGroup) === '● Running 2 commands · 5s (thinking 3s)');
check('a thought never changes the count', thinkingGroup[0].text.startsWith('Running 2 commands'));
check('a thought never becomes a command line', body(thinkingGroup).length === 2);

const thinkingFolded = group([row({ target: 'git status' })], { folded: true, thinking: thinking(4000) });
check('a folded row keeps its target and takes the bracket', header(thinkingFolded) === '● Running 1 command (git status) · 5s (thinking 4s) ctrl+o to expand');

const thinkingFailed = group([row({ status: ToolStatus.Failed })], { thinking: thinking(2000) });
check('a thought never hides a failure mark', thinkingFailed[0].mark.glyph === '✗');
check('a thought still joins a failure row', header(thinkingFailed) === '✗ Running 1 command · 5s (thinking 2s)');

const thinkingRead = readGroup([row({ target: 'src/a.ts' })], { thinking: thinking(1000) });
check('a read row takes the bracket too', header(thinkingRead) === '● Reading 1 file (src/a.ts) · 5s (thinking 1s) ctrl+o to expand');

const noThinking = group([row({})], { thinking: undefined });
check('a row without a thought has no bracket', !header(noThinking).includes('thinking'));

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
