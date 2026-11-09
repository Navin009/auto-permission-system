// Sensitive-command detection (src/core/policy/commands.ts).
import { matchedAskCommands } from '../../../src/core/index.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const cwd = '/home/me/proj';
const home = '/home/me';
const ask = ['printenv', 'env', '/proc/*/environ'];
const m = (cmd, list = ask) => matchedAskCommands(cmd, list, cwd, home);

check('printenv matches', m('printenv').includes('printenv'));
check('bare env matches', m('env').includes('env'));
check('env with args reaches the wrapped program, not env itself', m('env FOO=bar python app.py').length === 0);
check('env printing with a wrapper still matches', m('env | grep KEY').includes('env'));
check('sh -c printenv is inspected', m("sh -c 'printenv'").includes('printenv'));
check('bash -lc printenv is inspected', m("bash -lc 'printenv'").includes('printenv'));
check('sudo printenv is inspected', m('sudo -u me printenv').includes('printenv'));
check('an assignment prefix does not hide printenv', m('DEBUG=1 printenv').includes('printenv'));
check('a command substitution is inspected', m('echo $(printenv)').includes('printenv'));
check('the full path of printenv matches', m('/usr/bin/printenv').includes('printenv'));
check('cat /proc/self/environ matches', m('cat /proc/self/environ').length === 1);
check('strings /proc/1/environ matches', m('strings /proc/1/environ').length === 1);
check('grep TOKEN /proc/self/environ matches', m('grep TOKEN /proc/self/environ').length === 1);
check('chained command is inspected', m('echo hi && printenv').includes('printenv'));
check('a lookalike command does not match', m('myprintenv').length === 0);
check('unrelated command does not match', m('ls -la /tmp').length === 0);
check('empty ask list never matches', m('printenv', []).length === 0);
check('relative proc path is not the real one', m('cat ./proc/self/environ').length === 0);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
