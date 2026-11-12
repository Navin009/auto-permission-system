import { rowTarget } from '../../../src/core/tool-view/arguments.ts';
import { RowKind, rowKindOf, rowLabelOf } from '../../../src/core/tool-view/row-kind.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

check('owns bash as a shell row', rowKindOf('bash') === RowKind.Shell);
check('owns powershell as a shell row', rowKindOf('powershell') === RowKind.Shell);
check('owns read as a read row', rowKindOf('read') === RowKind.Read);
check('leaves edit to Pi', rowKindOf('edit') === undefined);
check('leaves ls to Pi', rowKindOf('ls') === undefined);
check('leaves grep to Pi', rowKindOf('grep') === undefined);
check('leaves find to Pi', rowKindOf('find') === undefined);
check('codemode is a row tool', rowKindOf('codemode') === 'codemode');
check('leaves write to Pi', rowKindOf('write') === undefined);
check('leaves an MCP tool to Pi', rowKindOf('mcp__docs__search') === undefined);
check('a prototype key is never a tool', rowKindOf('toString') === undefined);

check('a shell row runs commands', rowLabelOf(RowKind.Shell).verb === 'Running');
check('a shell row counts commands', rowLabelOf(RowKind.Shell).noun === 'command');
check('a shell row keeps its child lines', rowLabelOf(RowKind.Shell).showsChildLines === true);
check('a read row reads files', rowLabelOf(RowKind.Read).verb === 'Reading');
check('a read row counts files', rowLabelOf(RowKind.Read).noun === 'file');
check('a read row keeps its child lines', rowLabelOf(RowKind.Read).showsChildLines === true);

check('a bash target is the command', rowTarget('bash', { command: 'npm test' }) === 'npm test');
check('a powershell target is the command', rowTarget('powershell', { command: 'Get-ChildItem' }) === 'Get-ChildItem');
check('a read target is its path', rowTarget('read', { path: 'src/a.ts' }) === 'src/a.ts');
check('a read target takes file_path first', rowTarget('read', { file_path: 'src/b.ts', path: 'src/a.ts' }) === 'src/b.ts');
check('a read falls back to path', rowTarget('read', { file_path: '', path: 'src/a.ts' }) === 'src/a.ts');
check('a read slice ends the path', rowTarget('read', { path: 'src/a.ts', offset: 120, limit: 60 }) === 'src/a.ts:120-179');
check('an offset alone opens the slice', rowTarget('read', { path: 'src/a.ts', offset: 120 }) === 'src/a.ts:120');
check('a limit alone starts at the first line', rowTarget('read', { path: 'src/a.ts', limit: 40 }) === 'src/a.ts:1-40');
check('a string offset is read as a line', rowTarget('read', { path: 'src/a.ts', offset: '7', limit: '3' }) === 'src/a.ts:7-9');
check('a malformed limit is dropped', rowTarget('read', { path: 'src/a.ts', offset: 7, limit: 'many' }) === 'src/a.ts:7');
check('a whole-file read carries no range', rowTarget('read', { path: 'src/a.ts', offset: undefined, limit: undefined }) === 'src/a.ts');
check('a read without a path has no target', rowTarget('read', {}) === undefined);
check('a read with a non-string path has no target', rowTarget('read', { path: 42 }) === undefined);
check('an unowned tool has no target', rowTarget('edit', { path: 'src/a.ts' }) === undefined);
check('a blank command is dropped', rowTarget('bash', { command: '  ' }) === undefined);
check('a missing command has no target', rowTarget('bash', {}) === undefined);
check('a non-string command has no target', rowTarget('bash', { command: 42 }) === undefined);
check('undefined arguments give no target', rowTarget('bash', undefined) === undefined);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
