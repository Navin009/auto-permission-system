import { homedir } from 'node:os';
import { callCommand, callTarget, shortenTarget } from '../../../src/core/tool-view/arguments.ts';
import { ownsTool, TOOL_LABELS, toolLabelFor } from '../../../src/core/tool-view/labels.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

check('owns bash', ownsTool('bash') === true);
check('owns powershell', ownsTool('powershell') === true);
check('owns read', ownsTool('read') === true);
check('does not own write (write keeps Pi\'s block)', ownsTool('write') === false);
check('does not own an unknown tool', ownsTool('mcp__docs__search') === false);
check('does not own a prototype key', ownsTool('toString') === false);

check('bash label', toolLabelFor('bash')?.verb === 'Running' && toolLabelFor('bash')?.noun === 'command');
check('read label', toolLabelFor('read')?.verb === 'Reading' && toolLabelFor('read')?.noun === 'file');
check('edit label', toolLabelFor('edit')?.verb === 'Editing');
check('ls label noun is singular', toolLabelFor('ls')?.noun === 'directory');
check('unknown tool has no label', toolLabelFor('write') === undefined);
check('bash shows a command line', toolLabelFor('bash')?.showsCommandLine === true);
check('read does not show a command line', toolLabelFor('read')?.showsCommandLine === false);
check('read shows the expand hint', toolLabelFor('read')?.showsExpandHint === true);
check('bash does not show the expand hint', toolLabelFor('bash')?.showsExpandHint === false);
check('every label has a verb and a noun', Object.values(TOOL_LABELS).every((label) => label.verb && label.noun));

check('read target is the path', callTarget('read', { path: 'src/a.ts' }) === 'src/a.ts');
check('edit target is the path', callTarget('edit', { path: 'src/a.ts' }) === 'src/a.ts');
check('ls target is the path', callTarget('ls', { path: 'src' }) === 'src');
check('grep target is the pattern', callTarget('grep', { pattern: 'toolTitle' }) === 'toolTitle');
check('find target is the pattern', callTarget('find', { pattern: '*.ts' }) === '*.ts');
check('blank target is dropped', callTarget('read', { path: '   ' }) === undefined);
check('missing target is undefined', callTarget('read', {}) === undefined);
check('non-string target is undefined', callTarget('read', { path: 42 }) === undefined);
check('bash has no target', callTarget('bash', { command: 'ls' }) === undefined);
check('undefined args give no target', callTarget('read', undefined) === undefined);

check('bash command is the command', callCommand('bash', { command: 'npm test' }) === 'npm test');
check('powershell command is the command', callCommand('powershell', { command: 'Get-ChildItem' }) === 'Get-ChildItem');
check('read has no command line', callCommand('read', { path: 'src/a.ts' }) === undefined);
check('blank command is dropped', callCommand('bash', { command: '  ' }) === undefined);
check('missing command is undefined', callCommand('bash', {}) === undefined);

check('path inside cwd is relative', shortenTarget('/work/project/src/a.ts', '/work/project', '/home/dev') === 'src/a.ts');
check('cwd itself is a dot', shortenTarget('/work/project', '/work/project', '/home/dev') === '.');
check('path inside home is tilde', shortenTarget('/home/dev/notes.txt', '/work/project', '/home/dev') === '~/notes.txt');
check('cwd wins over home', shortenTarget('/home/dev/work/a.ts', '/home/dev/work', '/home/dev') === 'a.ts');
check('outside both is untouched', shortenTarget('/etc/hosts', '/work/project', '/home/dev') === '/etc/hosts');
check('home without a child is untouched', shortenTarget(homedir(), '/work/project', homedir()) !== undefined);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
