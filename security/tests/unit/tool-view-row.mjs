import { formatDuration } from '../../../src/core/tool-view/duration.ts';
import { buildRowText, pluralize, rowLine, rowLines } from '../../../src/core/tool-view/row-text.ts';
import { StatusMark, statusFromResult } from '../../../src/core/tool-view/status.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const HINT = 'ctrl+o to expand';
const row = (overrides) => ({
	verb: 'Reading',
	noun: 'file',
	count: 1,
	target: 'src/a.ts',
	command: undefined,
	durationMilliseconds: 1500,
	status: StatusMark.Ok,
	hint: HINT,
	...overrides,
});

check('formatDuration: under a second', formatDuration(400) === '0s');
check('formatDuration: seconds', formatDuration(4200) === '4s');
check('formatDuration: a minute', formatDuration(65_000) === '1m 5s');
check('formatDuration: negative clamps to zero', formatDuration(-500) === '0s');
check('formatDuration: not a number clamps to zero', formatDuration(Number.NaN) === '0s');

check('pluralize: one stays singular', pluralize('file', 1) === 'file');
check('pluralize: many adds s', pluralize('command', 3) === 'commands');
check('pluralize: y becomes ies', pluralize('directory', 2) === 'directories');

check('running read row', rowLine(buildRowText(row({ status: StatusMark.Running }))) === `● Reading 1 file (src/a.ts) · 1s ${HINT}`);
check('finished read row', rowLine(buildRowText(row({}))) === ` Reading 1 file (src/a.ts) · 1s ✓ ${HINT}`);
check('failed row', rowLine(buildRowText(row({ status: StatusMark.Failed }))) === ` Reading 1 file (src/a.ts) · 1s ✗ ${HINT}`);
check(
	'blocked row',
	rowLine(buildRowText(row({ status: StatusMark.Blocked, target: 'id_rsa' }))) === ` Reading 1 file (id_rsa) · 1s ✗ blocked ${HINT}`,
);
check(
	'denied row',
	rowLine(buildRowText(row({ status: StatusMark.Denied, target: 'https://x' }))) === ` Reading 1 file (https://x) · 1s ✗ denied ${HINT}`,
);
check('no target drops the parentheses', rowLine(buildRowText(row({ target: undefined }))) === ` Reading 1 file · 1s ✓ ${HINT}`);
check('no duration drops the dot segment', rowLine(buildRowText(row({ durationMilliseconds: undefined }))) === ` Reading 1 file (src/a.ts) ✓ ${HINT}`);
check('no hint when the label opts out', rowLine(buildRowText(row({ hint: undefined }))) === ' Reading 1 file (src/a.ts) · 1s ✓');
check('count pluralizes the noun', rowLine(buildRowText(row({ verb: 'Listing', noun: 'directory', count: 2, target: 'src' }))) === ` Listing 2 directories (src) · 1s ✓ ${HINT}`);

const commandDescription = {
	verb: 'Running',
	noun: 'command',
	count: 1,
	target: undefined,
	command: 'npm test',
	durationMilliseconds: 12_000,
	status: StatusMark.Failed,
	hint: undefined,
};
const commandRow = buildRowText(commandDescription);
check('shell row keeps one line of text', rowLine(commandRow) === ' Running 1 command · 12s ✗');
check('shell row adds the command line', commandRow.commandLine === '   └ $ npm test');
check('shell row renders two lines', rowLines(commandRow).length === 2);
check('file row renders one line', rowLines(buildRowText(row({}))).length === 1);
check(
	'running shell row keeps the dot gutter',
	rowLine(buildRowText({ ...commandDescription, status: StatusMark.Running })) === '● Running 1 command · 12s',
);

check('ok result', statusFromResult(false, 'done') === StatusMark.Ok);
check('error result', statusFromResult(true, 'boom') === StatusMark.Failed);
check('policy block', statusFromResult(true, 'Read blocked by policy: sensitive file') === StatusMark.Blocked);
check('user denial wins over the block marker', statusFromResult(true, '[Security Block] sandbox: read access to /x was denied by user.') === StatusMark.Denied);
check('the word block marks a result as blocked', statusFromResult(false, 'no blocked hosts') === StatusMark.Blocked);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
