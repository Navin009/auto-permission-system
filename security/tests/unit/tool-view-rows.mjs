import { rowGroupLines, pluralize } from '../../../src/core/tool-view/row-group.ts';
import { formatCommandDuration } from '../../../src/core/tool-view/duration.ts';
import { RowKind } from '../../../src/core/tool-view/row-kind.ts';
import { ToolStatus } from '../../../src/core/tool-view/status.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const HINT = 'ctrl+o to expand';
const WIDTH = 100;
const lineText = (line) => `${line.indent}${line.mark ? `${line.mark.glyph} ` : ''}${line.text}${line.hint ? ` ${line.hint}` : ''}${line.duration ? ` ${line.duration}` : ''}`;
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
const group = (rows, overrides, width = WIDTH) => rowGroupLines(summary(rows, overrides), width);
const readGroup = (rows, overrides, width = WIDTH) => group(rows, { kind: RowKind.Read, ...overrides }, width);
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
check('the row duration lives in its own column', one[0].duration === '· 5s');
check('the row text never carries the duration', one[0].text === 'Running 1 command');

const two = group([row({}), row({ target: 'npm run build', status: ToolStatus.Running })]);
check('two commands are counted', header(two) === '● Running 2 commands · 5s');
check('a finished command line carries its mark', body(two)[0] === '  └ ✓ $ npm test');
check('a running command line reads with an ellipsis and no duration', body(two)[1] === '  └ … $ npm run build');
check('several open commands carry no expand hint', two[0].hint === undefined);
check('a running group header stays open', two[0].mark.glyph === '●');
check('a running group is running', two[0].mark.status === ToolStatus.Running);

const failedLast = group([row({}), row({ status: ToolStatus.Failed })]);
check('the row takes the last command mark', failedLast[0].mark.glyph === '✗');
check('an earlier failure keeps its own line', body(failedLast)[0] === '  └ ✓ $ npm test');
check('the last failure keeps its own line', body(failedLast)[1] === '  └ ✗ $ npm test');

const failedFirst = group([row({ status: ToolStatus.Failed }), row({})]);
check('an earlier failure never turns the row red', failedFirst[0].mark.glyph === '✓');
check('a failure is never hidden by an ok neighbour', body(failedFirst)[0] === '  └ ✗ $ npm test');

const blockedLine = group([row({}), row({ status: ToolStatus.Blocked })]);
check('a blocked line names its gate', body(blockedLine)[1] === '  └ ✗ $ npm test blocked');

const deniedLine = group([row({}), row({ status: ToolStatus.Denied })]);
check('a denied line names its gate', body(deniedLine)[1] === '  └ ✗ $ npm test denied');

const singleDenied = group([row({ status: ToolStatus.Denied })]);
check('a single denied row names its gate on the header', header(singleDenied) === '✗ Running 1 command denied · 5s');

const foldedSingle = group([row({})], { folded: true });
check('a folded single command is one line', foldedSingle.length === 1);
check('a folded row names the last command', header(foldedSingle) === '✓ Running 1 command (npm test) ctrl+o to expand · 5s');
check('the hint stays with the text, before the duration column', foldedSingle[0].hint === HINT && foldedSingle[0].duration === '· 5s');

const foldedGroup = group([row({}), row({ target: 'npm run build' }), row({ target: 'git status' })], { folded: true });
check('a folded group is one line', foldedGroup.length === 1);
check(
	'a folded group names every program it ran',
	header(foldedGroup) === '✓ Running 3 commands (npm test, npm run build, git status) · 5s',
);

const tooMany = Array.from({ length: 6 }, (_, index) =>
	row({ target: `cmd${index} arg${index}.json`, hint: `cmd${index} arg${index}.json`, durationMilliseconds: 2000 }),
);
const ladderRows = [
	row({ target: 'tsc -p tsconfig.json', hint: 'tsc tsconfig.json', durationMilliseconds: 41_000 }),
	row({ target: 'npm test', hint: 'npm test', durationMilliseconds: 3000 }),
	row({ target: 'eslint src/core --fix', hint: 'eslint src/core', durationMilliseconds: 2000 }),
	row({ target: 'git add -A && git commit -m x', hint: 'git commit', durationMilliseconds: 4000 }),
	...tooMany.slice(0, 4).map((extra) => row({ ...extra, durationMilliseconds: 1500 })),
];
const ladder = (width) => header(group(ladderRows, { folded: true, durationMilliseconds: 55_000 }, width));

const wide = ladder(100);
check('wide columns name several programs with their hints', wide.includes('tsc tsconfig.json') && wide.includes('npm test'));
check('wide columns count what they hid', /\+\d+/.test(wide));
check('wide columns never overflow their width', wide.length <= 100);
const middle = ladder(72);
check('narrower columns show fewer programs', middle.length <= 72 && middle.includes('+'));
const narrow = ladder(56);
check('a very narrow header falls back to the overflow count', narrow.includes('+') && narrow.length <= 56);
check('an overflow never starts with a space', !narrow.includes('( +') && !wide.includes('( +'));

const foldedDenied = group([row({ status: ToolStatus.Denied })], { folded: true });
check('a folded denial stays named', header(foldedDenied) === '✗ Running 1 command (npm test) denied ctrl+o to expand · 5s');

const many = Array.from({ length: 11 }, (_, index) => row({ target: `cmd-${index}` }));
const window = group(many);
check('the header counts every command', window[0].text === 'Running 11 commands');
check('only the newest eight command lines are drawn', body(window).length === 9);
check('older commands collapse to one line', body(window)[0] === '  └ ... (3 earlier calls)');
check('the newest command is last', body(window).at(-1) === '  └ ✓ $ cmd-10');
check('an eight-command group needs no overflow line', body(group(many.slice(0, 8)))[0] === '  └ ✓ $ cmd-0');
check('the overflow line pluralizes for one hidden command', body(group(many.slice(0, 9)))[0] === '  └ ... (1 earlier call)');

check('a command without a duration is drawn like any other', body(group([row({}), row({ target: 'git status', durationMilliseconds: undefined })]))[1] === '  └ ✓ $ git status');
check(
	'only the header carries a duration',
	group([row({}), row({ target: 'git status' })])[0].duration === '· 5s' &&
		body(group([row({}), row({ target: 'git status' })])).every((line) => !/\d(ms|s)$/.test(line)),
);
check('a command may span lines and stays one row', body(group([row({ target: 'npm test\nrm -rf /' })]))[0] === '  └ $ npm test rm -rf /');
check('a folded target never spans lines', group([row({ target: 'git status\n' })], { folded: true })[0].text.includes('(git status)'));

const oneRead = readGroup([row({ target: 'src/a.ts' })]);
check('one read draws its file line', oneRead.length === 2);
check('a read row reads a file', header(oneRead) === '✓ Reading 1 file · 5s');
check('a single read line carries no mark and no duration', body(oneRead)[0] === '  └ src/a.ts');
check('an open read row carries no expand hint', oneRead[0].hint === undefined);
check('a read line never grows a prompt', !body(oneRead)[0].includes('$'));

const threeReads = readGroup([row({ target: 'src/a.ts' }), row({ target: 'src/b.ts' }), row({ target: 'src/c.ts' })]);
check('reads are counted as files', header(threeReads) === '✓ Reading 3 files · 5s');
check('a read row lists one file per line', body(threeReads).join('|') === '  └ ✓ src/a.ts|  └ ✓ src/b.ts|  └ ✓ src/c.ts');
check('a read line carries no prompt', body(threeReads).every((line) => !line.includes('$')));

const foldedThreeReads = readGroup(
	[row({ target: 'src/a.ts' }), row({ target: 'src/b.ts' }), row({ target: 'src/c.ts' })],
	{ folded: true },
);
check('a folded read row names the last file', header(foldedThreeReads) === '✓ Reading 3 files (src/c.ts) ctrl+o to expand · 5s');
check('a folded read row draws no lines', foldedThreeReads.length === 1);

const runningRead = readGroup([row({ target: 'src/a.ts' }), row({ status: ToolStatus.Running, target: 'src/b.ts', durationMilliseconds: undefined })]);
check('a running read line ends on an ellipsis and no duration', body(runningRead)[1] === '  └ … src/b.ts');
check('a running read header stays open', header(runningRead) === '● Reading 2 files · 5s');

const failedRead = readGroup([row({ target: 'src/a.ts' }), row({ status: ToolStatus.Blocked, target: '~/.ssh/id_rsa', durationMilliseconds: undefined })]);
check('a blocked read keeps its word on its own line', body(failedRead)[1] === '  └ ✗ ~/.ssh/id_rsa blocked');
check('a blocked read in the middle keeps the header on the last read', header(failedRead) === '✗ Reading 2 files · 5s');
check('a blocked read line has no duration', failedRead[2].duration === undefined);
const singleFailedRead = readGroup([row({ status: ToolStatus.Blocked, target: '~/.ssh/id_rsa', durationMilliseconds: undefined })]);
check('a single blocked read says so on its row', header(singleFailedRead) === '✗ Reading 1 file blocked · 5s');
check('a single blocked read line carries no repeated word', body(singleFailedRead)[0] === '  └ ~/.ssh/id_rsa');

const shellWithRead = group([row({})], { kind: RowKind.Shell });
check('a shell row keeps its prompt', body(shellWithRead)[0] === '  └ $ npm test');

const thinkingGroup = group([row({}), row({ target: 'npm run build' })], { thinking: thinking(3000) });
check('a thought rides in the target slot, before the row duration', header(thinkingGroup) === '● Running 2 commands (thinking 3s) · 5s');
check('a thought never changes the count', thinkingGroup[0].text.startsWith('Running 2 commands'));
check('a thought never becomes a command line', body(thinkingGroup).length === 2);

const thinkingFolded = group([row({ target: 'git status' })], { folded: true, thinking: thinking(4000) });
check('a folded row keeps its target and takes the bracket', header(thinkingFolded) === '● Running 1 command (git status) (thinking 4s) ctrl+o to expand · 5s');

const thinkingFailed = group([row({ status: ToolStatus.Failed })], { thinking: thinking(2000) });
check('a thought never hides a failure mark', thinkingFailed[0].mark.glyph === '✗');
check('a thought still joins a failure row', header(thinkingFailed) === '✗ Running 1 command (thinking 2s) · 5s');

const thinkingRead = readGroup([row({ target: 'src/a.ts' })], { thinking: thinking(1000) });
check('a read row takes the bracket too', header(thinkingRead) === '● Reading 1 file (thinking 1s) · 5s');

const noThinking = group([row({})], { thinking: undefined });
check('a row without a thought has no bracket', !header(noThinking).includes('thinking'));

const LONG_COMMAND = "cd /home/navinkumar/workspace/auto-permission-system && sed -n 570,600p plan/tool-rows-views.md && echo '--- 660-700' && sed -n 660,700p plan/tool-rows-views.md";
const foldedAt = (width) => header(group([row({ target: LONG_COMMAND })], { folded: true }, width));

check('a folded compound command names its last segment', foldedAt(100) === '✓ Running 1 command (sed -n 660,700p plan/tool-rows-views.md) ctrl+o to expand · 5s');
check('a long target keeps its tail at 80 columns', foldedAt(80) === '✓ Running 1 command (… 660,700p plan/tool-rows-views.md) ctrl+o to expand · 5s');
check('a long target drops whole tokens at 72 columns', foldedAt(72) === '✓ Running 1 command (… plan/tool-rows-views.md) ctrl+o to expand · 5s');
check('a target with no room is dropped', foldedAt(60) === '✓ Running 1 command ctrl+o to expand · 5s');
check('a dropped target keeps the duration and the hint', foldedAt(60).endsWith('ctrl+o to expand · 5s'));
check('a short target is never cut', foldedAt(200).includes('(sed -n 660,700p plan/tool-rows-views.md)'));

const longRead = readGroup([row({ target: 'src/core/tool-view/row-group.ts' })], { folded: true }, 70);
check('a long read path keeps its file name', header(longRead) === '✓ Reading 1 file (… core/tool-view/row-group.ts) ctrl+o to expand · 5s');

const cutReadLine = body(readGroup([row({ target: 'src/a.ts' }), row({ target: 'src/core/tool-view/target-summary.ts' })], {}, 50))[1];
check('a read line is cut with an ellipsis at a path boundary', cutReadLine === '  └ ✓ … tool-view/target-summary.ts');
check('a read line never outruns the terminal', cutReadLine.length < 50);

const LONG_CHILD = "rg -n 'tool-view|row-group' src/core plan security/tests --glob '*.ts' --glob '*.mjs'";
const childAt = (width, target = LONG_CHILD) => group([row({ target }), row({ target })], {}, width)[1];
const wideChild = childAt(200);
check('a fitting child command is untouched', wideChild.text === `$ ${LONG_CHILD}`);
check('a child line carries no duration of its own', wideChild.duration === undefined);

const cappedChild = childAt(100);
check('the child command column stops at 70% of the width', cappedChild.text.length + '  └ ✓ '.length <= 70);
check('a cut child keeps its program and its tail', cappedChild.text.startsWith('$ rg ') && cappedChild.text.includes(' … ') && cappedChild.text.endsWith("'*.mjs'"));

const tinyChild = childAt(30, 'src/core/tool-view/row-group.ts --flag');
check('a tiny column still names the tail', tinyChild.text === '$ … --flag');
check('a single command row carries no duration column', body(one)[0] === '  └ $ npm test' && group([row({})])[1].duration === undefined);

const pipelineChild = childAt(100, 'head -40 src/a.ts | head');
check('a child line keeps a pipeline whole', pipelineChild.text === '$ head -40 src/a.ts | head');

const cdChild = childAt(100, 'cd /work && npm test');
check('a child line drops the leading cd', cdChild.text === '$ npm test');

const manyReads = Array.from({ length: 10 }, (_, index) => row({ target: `src/file-${index}.ts` }));
check('a read run shows the newest eight lines', body(readGroup(manyReads)).at(-1) === '  └ ✓ src/file-9.ts');
check('a read run reports the earlier calls', body(readGroup(manyReads))[0] === '  └ ... (2 earlier calls)');

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
