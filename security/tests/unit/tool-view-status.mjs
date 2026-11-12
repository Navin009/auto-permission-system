import { statusFromResult, statusMark, statusWord, ToolStatus } from '../../../src/core/tool-view/status.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

check('ok result', statusFromResult(false, 'done') === ToolStatus.Ok);
check('error result', statusFromResult(true, 'boom') === ToolStatus.Failed);
check('policy block', statusFromResult(true, 'Read blocked by policy: sensitive file') === ToolStatus.Blocked);
check('user denial wins over the block marker', statusFromResult(true, '[Security Block] sandbox: read access to /x was denied by user.') === ToolStatus.Denied);
check('a successful result is never a refusal', statusFromResult(false, 'the ResultContentBlock type') === ToolStatus.Ok);
check('a failing result that mentions block is a failure', statusFromResult(true, 'the ResultContentBlock type') === ToolStatus.Failed);

check('running draws the dot', statusMark(ToolStatus.Running) === '●');
check('ok draws a tick', statusMark(ToolStatus.Ok) === '✓');
check('failed draws a cross', statusMark(ToolStatus.Failed) === '✗');
check('blocked draws the same cross', statusMark(ToolStatus.Blocked) === '✗');
check('denied draws the same cross', statusMark(ToolStatus.Denied) === '✗');

check('running needs no word', statusWord(ToolStatus.Running) === undefined);
check('ok needs no word', statusWord(ToolStatus.Ok) === undefined);
check('failed needs no word', statusWord(ToolStatus.Failed) === undefined);
check('blocked says so', statusWord(ToolStatus.Blocked) === 'blocked');
check('denied says so', statusWord(ToolStatus.Denied) === 'denied');

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
