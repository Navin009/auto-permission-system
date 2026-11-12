import { commandGroupText, commandLinePrefix } from '../../../src/core/tool-view/command-group.ts';
import { formatCommandDuration } from '../../../src/core/tool-view/duration.ts';
import { StatusMark } from '../../../src/core/tool-view/status.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const HINT = 'ctrl+o to expand';
const commandLineText = (line) => `${commandLinePrefix()}${line.mark ? `${line.mark} ` : ''}${line.text}`;
const command = (overrides) => ({
	command: 'npm test',
	status: StatusMark.Ok,
	durationMilliseconds: 1200,
	...overrides,
});
const group = (commands, overrides) => commandGroupText({ commands, totalDurationMilliseconds: 5000, hint: HINT, ...overrides });

check('formatCommandDuration: under a second', formatCommandDuration(320) === '320ms');
check('formatCommandDuration: round milliseconds', formatCommandDuration(999.6) === '1000ms');
check('formatCommandDuration: tenths of a second', formatCommandDuration(1200) === '1.2s');
check('formatCommandDuration: whole seconds', formatCommandDuration(12_400) === '12s');
check('formatCommandDuration: negative clamps to zero', formatCommandDuration(-90) === '0ms');
check('formatCommandDuration: not a number clamps to zero', formatCommandDuration(Number.NaN) === '0ms');

const one = group([command({})]);
check('one command keeps a plain command line', commandLineText(one.commandLines[0]) === '   └ $ npm test');
check('one command header', `${one.mark} ${one.body}` === '✓ Running 1 command · 5s');
check('one command carries no expand hint', one.hint === undefined);
check('one command has no overflow line', one.overflowLine === undefined);

const two = group([command({}), command({ command: 'npm run build', status: StatusMark.Running, durationMilliseconds: 400 })]);
check('two commands are counted', two.body === 'Running 2 commands · 5s');
check('a finished command line carries its mark and duration', commandLineText(two.commandLines[0]) === '   └ ✓ $ npm test · 1.2s');
check('a running command line reads with an ellipsis', commandLineText(two.commandLines[1]) === '   └ … $ npm run build · 400ms');
check('several commands carry the expand hint', two.hint === HINT);
check('a running group header stays open', two.mark === '●');
check('a running group is running', two.status === StatusMark.Running);

const failed = group([command({}), command({ status: StatusMark.Failed })]);
check('a failed command marks the group', failed.mark === '✗');
check('a failure is never hidden by an ok neighbour', failed.commandLines[0].mark === '✓' && failed.commandLines[1].mark === '✗');

check('a block outranks a failure', group([command({ status: StatusMark.Failed }), command({ status: StatusMark.Blocked })]).mark === '✗ blocked');
check('a denial outranks a block', group([command({ status: StatusMark.Blocked }), command({ status: StatusMark.Denied })]).mark === '✗ denied');
check(
	'a blocked command line keeps the word',
	commandLineText(group([command({ status: StatusMark.Ok }), command({ status: StatusMark.Blocked })]).commandLines[1]) === '   └ ✗ blocked $ npm test · 1.2s',
);

const many = Array.from({ length: 11 }, (_, index) => command({ command: `cmd-${index}` }));
const window = group(many);
check('the header counts every command', window.body === 'Running 11 commands · 5s');
check('only the newest eight command lines are drawn', window.commandLines.length === 8);
check('the newest command is last', commandLineText(window.commandLines.at(-1)) === '   └ ✓ $ cmd-10 · 1.2s');
check('older commands collapse to one line', window.overflowLine === '   └ ... (3 earlier calls)');
check('an eight-command group needs no overflow line', group(many.slice(0, 8)).overflowLine === undefined);
check('the overflow line pluralizes for one hidden command', group(many.slice(0, 9)).overflowLine === '   └ ... (1 earlier call)');

check('a command without a duration drops the segment', commandLineText(group([command({}), command({ durationMilliseconds: undefined })]).commandLines[1]) === '   └ ✓ $ npm test');
check('a single command hides its duration in the header only', group([command({ durationMilliseconds: undefined })]).commandLines.length === 1);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
