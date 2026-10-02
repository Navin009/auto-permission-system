// "User named it" for reads outside the project (ADR-012). Imports the real lib.
import { extractUserMessages, userNamedFile } from '../../lib/user-named.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };
const home = '/Users/me', cwd = '/Users/me/repo';
const file = (canonical, spelled) => ({ canonical, spelled, cwd, home });

const branch = [
  { type: 'message', message: { role: 'user', content: 'Compare with ~/other/config.yml please.' } },
  { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Reading /Users/me/other/.env too' }] } },
  { type: 'message', message: { role: 'toolResult', content: [{ type: 'text', text: 'see /Users/me/.netrc' }] } },
  { type: 'custom', data: { text: '/Users/me/other/secrets.yml' } },
];
const users = extractUserMessages(branch);
check('only user messages', users.length === 1);
check('user-named ~ path', userNamedFile(users, file('/Users/me/other/config.yml')) === '~/other/config.yml');
check('assistant text cannot name a path', userNamedFile(users, file('/Users/me/other/.env')) === null);
check('tool result cannot name a path', userNamedFile(users, file('/Users/me/.netrc')) === null);
check('custom entry cannot name a path', userNamedFile(users, file('/Users/me/other/secrets.yml')) === null);

const other = file('/Users/me/other/.env');
check('outside: basename is not enough', userNamedFile(['read .env'], other) === null);
check('outside: absolute path counts', userNamedFile(['read /Users/me/other/.env'], other) === '/Users/me/other/.env');
check('outside: ~ path counts', userNamedFile(['read ~/other/.env'], other) === '~/other/.env');
check('outside: parent folder is not the file', userNamedFile(['look in ~/other'], other) === null);
check('outside: longer name is not this file', userNamedFile(['read ~/other/.env.example'], other) === null);
check('outside: sentence end', userNamedFile(['read ~/other/.env.'], other) === '~/other/.env');
check('spelled /tmp vs canonical /private/tmp', userNamedFile(['read /tmp/x/notes.txt'], { canonical: '/private/tmp/x/notes.txt', spelled: '/tmp/x/notes.txt', cwd, home }) === '/tmp/x/notes.txt');
check('case-insensitive when asked', userNamedFile(['READ ~/OTHER/.ENV'], other, true) === '~/other/.env');
check('case-sensitive otherwise', userNamedFile(['READ ~/OTHER/.ENV'], other, false) === null);
check('inside: basename counts', userNamedFile(['open .env'], file('/Users/me/repo/.env')) === '.env');
check('no messages', userNamedFile([], other) === null);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
