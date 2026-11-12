import { callCommand } from '../../../src/core/tool-view/arguments.ts';
import { isCommandTool } from '../../../src/core/tool-view/labels.ts';
import { StatusMark, statusFromResult } from '../../../src/core/tool-view/status.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

check('owns bash', isCommandTool('bash') === true);
check('owns powershell', isCommandTool('powershell') === true);
check('leaves read to Pi', isCommandTool('read') === false);
check('leaves edit to Pi', isCommandTool('edit') === false);
check('leaves ls to Pi', isCommandTool('ls') === false);
check('leaves grep to Pi', isCommandTool('grep') === false);
check('leaves find to Pi', isCommandTool('find') === false);
check('leaves codemode to Pi', isCommandTool('codemode') === false);
check('leaves write to Pi', isCommandTool('write') === false);
check('leaves an MCP tool to Pi', isCommandTool('mcp__docs__search') === false);
check('a prototype key is never a tool', isCommandTool('toString') === false);

check('bash command is the command', callCommand('bash', { command: 'npm test' }) === 'npm test');
check('powershell command is the command', callCommand('powershell', { command: 'Get-ChildItem' }) === 'Get-ChildItem');
check('read has no command line', callCommand('read', { path: 'src/a.ts' }) === undefined);
check('blank command is dropped', callCommand('bash', { command: '  ' }) === undefined);
check('missing command is undefined', callCommand('bash', {}) === undefined);
check('non-string command is undefined', callCommand('bash', { command: 42 }) === undefined);
check('undefined args give no command', callCommand('bash', undefined) === undefined);

check('ok result', statusFromResult(false, 'done') === StatusMark.Ok);
check('error result', statusFromResult(true, 'boom') === StatusMark.Failed);
check('policy block', statusFromResult(true, 'Read blocked by policy: sensitive file') === StatusMark.Blocked);
check('user denial wins over the block marker', statusFromResult(true, '[Security Block] sandbox: read access to /x was denied by user.') === StatusMark.Denied);
check('a successful result is never a refusal', statusFromResult(false, 'the ResultContentBlock type') === StatusMark.Ok);
check('a failing result that mentions block is a failure', statusFromResult(true, 'the ResultContentBlock type') === StatusMark.Failed);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
