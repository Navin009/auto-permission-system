// askRead (ADR-019): sensitive paths ASK instead of being hard-denied.
import { askReadCandidates, sandboxFilesystem, loadDefaultPolicy } from '../../../src/core/index.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

const cwd = '/home/me/proj';
const home = '/home/me';
const fs = { denyRead: ['~/.ssh'], allowWrite: ['.'], denyWrite: ['.env'], askRead: ['.env', '.env.*'] };
const exists = () => true;
const c = (cmd) => askReadCandidates(cmd, cwd, home, fs, exists);

check('cat .env is an ask-read candidate', c('cat .env').includes(`${cwd}/.env`));
check('cat .env.local matches .env.*', c('cat .env.local').includes(`${cwd}/.env.local`));
check('a nested path matches', c('cat config/.env').includes(`${cwd}/config/.env`));
check('an unrelated file is not a candidate', c('cat src/app.ts').length === 0);
check('echo is not a read command', c('echo .env').length === 0);
check('denyRead wins over askRead', askReadCandidates('cat ~/.ssh/x', cwd, home, { ...fs, askRead: ['~/.ssh'] }, exists).length === 0);
check('an empty askRead list is a no-op', askReadCandidates('cat .env', cwd, home, { ...fs, askRead: [] }, exists).length === 0);

const d = loadDefaultPolicy()?.filesystem ?? {};
check('default: .env is in askRead', (d.askRead ?? []).includes('.env'));
check('default: .env is NOT in denyRead', !(d.denyRead ?? []).includes('.env'));
check('default: .env stays in denyWrite', (d.denyWrite ?? []).includes('.env'));

const sandboxFs = sandboxFilesystem({ denyRead: ['~/.ssh'], allowWrite: ['.'], denyWrite: ['.env'], askRead: ['.env'] }, { cwd, home });
check('sandbox-runtime never sees askRead', !JSON.stringify(sandboxFs).includes('askRead'));
check('sandbox denyRead does not carry .env', !sandboxFs.denyRead.some((p) => p.includes('.env')));

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
