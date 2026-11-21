// L2 grep output filter + policy-file guards. Imports the real lib (Node 24 strips the
// types), unlike the older tests that re-implement the logic.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filterGrepOutput, policyFileError, readPolicyForUpdate } from '../../../src/core/index.ts';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL:', name); } }

const denied = new Set(['.env', 'conf/server.pem', 'odd-name-3-x.txt']);
const isDenied = (p) => denied.has(p);

const out = [
  'src/app.ts:12: const key = process.env.KEY',
  '.env:1: KEY=sk-live-123',
  '.env-2- # comment',
  'conf/server.pem:1: -----BEGIN PRIVATE KEY-----',
  '--',
  'src/app.ts-13- return key',
  'odd-name-3-x.txt:4: secret',
  '[Showing first 100 matches]',
].join('\n');
const r = filterGrepOutput(out, isDenied);

check('keeps allowed match line', r.text.includes('src/app.ts:12:'));
check('keeps allowed context line', r.text.includes('src/app.ts-13-'));
check('drops denied match line', !r.text.includes('sk-live-123'));
check('drops denied context line', !r.text.includes('.env-2-'));
check('drops nested denied file', !r.text.includes('BEGIN PRIVATE KEY'));
check('drops path containing -N- pattern', !r.text.includes('odd-name-3-x.txt'));
check('keeps separators and notices', r.text.includes('--') && r.text.includes('[Showing first 100 matches]'));
check('counts removed lines', r.removedLines === 4);
check('lists removed files once', r.removedFiles.length === 3);
check('no-op when nothing denied', filterGrepOutput(out, () => false).text === out);

const dir = join(tmpdir(), `auto-permission-system-test-${process.pid}`);
mkdirSync(dir, { recursive: true });
const good = join(dir, 'good.json'), bad = join(dir, 'bad.json');
writeFileSync(good, '{"filesystem":{"allowWrite":["."]}}');
writeFileSync(bad, '{"filesystem":{"allowWrite":[".", "~/.cache",]}}');
check('policyFileError: valid file', policyFileError(good) === null);
check('policyFileError: absent file', policyFileError(join(dir, 'none.json')) === null);
check('policyFileError: trailing comma reported', typeof policyFileError(bad) === 'string');
check('readPolicyForUpdate: absent file is empty', Object.keys(readPolicyForUpdate(join(dir, 'none.json'))).length === 0);
let threw = false;
try { readPolicyForUpdate(bad); } catch { threw = true; }
check('readPolicyForUpdate: refuses to overwrite unparseable file', threw);

// Integration: the guard builds the path it checks from what grep printed. An
// absolute printed path must not be re-rooted under the search directory,
// because `join('/root', '/abs/file')` is `/root/abs/file` -- a path that does
// not exist, so the deny/ask check would pass the line through.
process.env.PI_CODING_AGENT_DIR = join(dir, 'agent');
const { filterGrepToolResult } = await import('../../../src/l2-guard/output-gates.ts');

const deniedDirectory = join(dir, 'denied');
const askedDirectory = join(dir, 'asked');
const guardPolicy = {
  enabled: true,
  network: { allowedDomains: [], deniedDomains: [] },
  filesystem: {
    denyRead: [deniedDirectory],
    askRead: [askedDirectory],
    allowWrite: [dir],
    denyWrite: [],
  },
  overrides: { allowRead: [], allowWrite: [] },
};
const guardContext = { cwd: dir };
const grepEvent = (text) => ({ toolName: 'grep', isError: false, input: { path: dir }, content: [{ type: 'text', text }] });

const absoluteLines = [
  `${join(deniedDirectory, 'secret.txt')}:1: sk-live-absolute`,
  `${join(askedDirectory, 'token.txt')}:2: token-absolute`,
  'src/app.ts:3: harmless',
].join('\n');
const absoluteResult = filterGrepToolResult(grepEvent(absoluteLines), guardContext, guardPolicy);
const absoluteText = JSON.stringify(absoluteResult ?? {});

check('absolute denyRead path is filtered', !absoluteText.includes('sk-live-absolute'), absoluteText);
check('absolute askRead path is filtered', !absoluteText.includes('token-absolute'), absoluteText);
check('an allowed line survives the absolute case', absoluteText.includes('harmless'), absoluteText);

const relativeLines = ['denied/secret.txt:4: sk-live-relative', 'src/app.ts:5: harmless'].join('\n');
const relativeResult = filterGrepToolResult(grepEvent(relativeLines), guardContext, guardPolicy);
const relativeText = JSON.stringify(relativeResult ?? {});

check('a relative denied path is still filtered', !relativeText.includes('sk-live-relative'), relativeText);
check('the removal is reported', relativeText.includes('removed 1 line'), relativeText);
check('a clean result is left untouched', filterGrepToolResult(grepEvent('src/app.ts:6: harmless'), guardContext, guardPolicy) === undefined);

rmSync(dir, { recursive: true, force: true });

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
