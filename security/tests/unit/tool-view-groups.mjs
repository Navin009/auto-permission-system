import { commandGroupLines, pluralize } from '../../../src/core/tool-view/command-group.ts';
import { formatCommandDuration } from '../../../src/core/tool-view/duration.ts';
import { ToolStatus } from '../../../src/core/tool-view/status.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const HINT = 'ctrl+o to expand';
const lineText = (line) => `${line.indent}${line.mark ? `${line.mark.glyph} ` : ''}${line.text}${line.hint ? ` ${line.hint}` : ''}`;
const command = (overrides) => ({ command: 'npm test', status: ToolStatus.Ok, durationMilliseconds: 1200, ...overrides });
const group = (commands, overrides) => commandGroupLines({ commands, durationMilliseconds: 5000, folded: false, hint: HINT, ...overrides });
const header = (lines) => lineText(lines[0]);
const body = (lines) => lines.slice(1).map(lineText);

check('formatCommandDuration: under a second', formatCommandDuration(320) === '320ms');
check('formatCommandDuration: round milliseconds', formatCommandDuration(999.6) === '1000ms');
check('formatCommandDuration: tenths of a second', formatCommandDuration(1200) === '1.2s');
check('formatCommandDuration: whole seconds', formatCommandDuration(12_400) === '12s');
check('formatCommandDuration: negative clamps to zero', formatCommandDuration(-90) === '0ms');
check('formatCommandDuration: not a number clamps to zero', formatCommandDuration(Number.NaN) === '0ms');

check('a count of one stays singular', pluralize('command', 1) === 'command');
check('more than one is plural', pluralize('command', 2) === 'commands');
check('a noun ending in y takes ies', pluralize('entry', 3) === 'entries');

const one = group([command({})]);
check('one command header', header(one) === '✓ Running 1 command · 5s');
check('one command keeps a plain command line', body(one)[0] === '  └ $ npm test');
check('one open row carries no expand hint', one[0].hint === undefined);
check('one command has no overflow line', one.length === 2);

const two = group([command({}), command({ command: 'npm run build', status: ToolStatus.Running })]);
check('two commands are counted', two[0].text === 'Running 2 commands · 5s');
check('a finished command line carries its mark and duration', body(two)[0] === '  └ ✓ $ npm test 1.2s');
check('a running command line reads with an ellipsis and no duration', body(two)[1] === '  └ … $ npm run build');
check('several open commands carry no expand hint', two[0].hint === undefined);
check('a running group header stays open', two[0].mark.glyph === '●');
check('a running group is running', two[0].mark.status === ToolStatus.Running);

const failedLast = group([command({}), command({ status: ToolStatus.Failed })]);
check('the row takes the last command mark', failedLast[0].mark.glyph === '✗');
check('an earlier failure keeps its own line', body(failedLast)[0] === '  └ ✓ $ npm test 1.2s');
check('the last failure keeps its own line', body(failedLast)[1] === '  └ ✗ $ npm test 1.2s');

const failedFirst = group([command({ status: ToolStatus.Failed }), command({})]);
check('an earlier failure never turns the row red', failedFirst[0].mark.glyph === '✓');
check('a failure is never hidden by an ok neighbour', body(failedFirst)[0] === '  └ ✗ $ npm test 1.2s');

const blockedLine = group([command({}), command({ status: ToolStatus.Blocked })]);
check('a blocked line names its gate', body(blockedLine)[1] === '  └ ✗ $ npm test 1.2s blocked');

const deniedLine = group([command({}), command({ status: ToolStatus.Denied })]);
check('a denied line names its gate', body(deniedLine)[1] === '  └ ✗ $ npm test 1.2s denied');

const singleDenied = group([command({ status: ToolStatus.Denied })]);
check('a single denied row names its gate on the header', header(singleDenied) === '✗ Running 1 command · 5s denied');

const foldedSingle = group([command({})], { folded: true });
check('a folded single command is one line', foldedSingle.length === 1);
check('a folded row names the last command', header(foldedSingle) === '✓ Running 1 command (npm test) · 5s ctrl+o to expand');

const foldedGroup = group([command({}), command({ command: 'npm run build' }), command({ command: 'git status' })], { folded: true });
check('a folded group is one line', foldedGroup.length === 1);
check('a folded group names the last command', header(foldedGroup) === '✓ Running 3 commands (git status) · 5s ctrl+o to expand');

const foldedDenied = group([command({ status: ToolStatus.Denied })], { folded: true });
check('a folded denial stays named', header(foldedDenied) === '✗ Running 1 command (npm test) · 5s denied ctrl+o to expand');

const many = Array.from({ length: 11 }, (_, index) => command({ command: `cmd-${index}` }));
const window = group(many);
check('the header counts every command', window[0].text === 'Running 11 commands · 5s');
check('only the newest eight command lines are drawn', body(window).length === 9);
check('older commands collapse to one line', body(window)[0] === '  └ ... (3 earlier calls)');
check('the newest command is last', body(window).at(-1) === '  └ ✓ $ cmd-10 1.2s');
check('an eight-command group needs no overflow line', body(group(many.slice(0, 8)))[0] === '  └ ✓ $ cmd-0 1.2s');
check('the overflow line pluralizes for one hidden command', body(group(many.slice(0, 9)))[0] === '  └ ... (1 earlier call)');

check('a command without a duration drops the segment', body(group([command({}), command({ command: 'git status', durationMilliseconds: undefined })]))[1] === '  └ ✓ $ git status');
check('a command may span lines and stays one row', body(group([command({ command: 'npm test\nrm -rf /' })]))[0] === '  └ $ npm test rm -rf /');
check('a folded target never spans lines', group([command({ command: 'git\nstatus' })], { folded: true })[0].text.includes('(git status)'));

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
