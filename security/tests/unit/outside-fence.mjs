// Outside-project fence for Layer 1 (ADR-014) and the shared default deny list.
// Imports the real lib (Node strips the types), like the other newer tests.
import { DEFAULT_DENY_READ, outsideProjectMode, outsideProjectReadCandidates, outsideProjectReadDenied, sandboxFilesystem } from '../../../src/core/index.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const cwd = '/home/me/proj';
const home = '/home/me';
const fs = (over = {}) => ({
  denyRead: ['~/.ssh', '~/.pi/agent'],
  allowWrite: ['.', '/tmp'],
  denyWrite: ['.env', '*.pem'],
  ...over,
});

// --- shared defaults (Issue 2) ---
check('default denyRead includes ~/.pi/agent', DEFAULT_DENY_READ.includes('~/.pi/agent'));
check('default denyRead keeps credentials', ['~/.ssh', '~/.aws', '~/.gnupg'].every((p) => DEFAULT_DENY_READ.includes(p)));

// --- mode ---
check('default mode is allow', outsideProjectMode(fs()) === 'allow');
check('explicit ask', outsideProjectMode(fs({ outsideProject: { read: 'ask' } })) === 'ask');
check('explicit deny', outsideProjectMode(fs({ outsideProject: { read: 'deny' } })) === 'deny');

// --- per-path classification (ask) ---
const ask = fs({ outsideProject: { read: 'ask', allowRead: ['/srv/shared'] } });
check('project path is inside', !outsideProjectReadDenied('/home/me/proj/src/a.ts', cwd, home, ask));
check('project root is inside', !outsideProjectReadDenied(cwd, cwd, home, ask));
check('home path is outside', outsideProjectReadDenied('/home/me/.bashrc', cwd, home, ask));
check('agent dir is outside', outsideProjectReadDenied('/home/me/.pi/agent/mcp.json', cwd, home, ask));
check('allowWrite root is not outside', !outsideProjectReadDenied('/tmp/scratch', cwd, home, ask));
check('outsideProject.allowRead is not outside', !outsideProjectReadDenied('/srv/shared/x', cwd, home, ask));
check('filesystem.allowRead is not outside', !outsideProjectReadDenied('/opt/data/x', cwd, home, fs({ allowRead: ['/opt/data'], outsideProject: { read: 'ask' } })));
check('mode allow never gates', !outsideProjectReadDenied('/home/me/.bashrc', cwd, home, fs()));

// --- sandboxFilesystem: mode allow leaves the boundary off ---
const plain = sandboxFilesystem(fs(), { cwd, home });
check('allow: no home fence', !plain.denyRead.includes(home));
check('allow: allowRead empty', plain.allowRead.length === 0);
check('allow: denyWrite translated', plain.denyWrite.includes('**/.env') && plain.denyWrite.includes('**/*.pem'));
check('allow: denyRead untouched', plain.denyRead.includes('~/.ssh') && plain.denyRead.includes('~/.pi/agent'));

// --- sandboxFilesystem: the fence ---
const fenced = sandboxFilesystem(ask, { cwd, home });
check('fence denies home', fenced.denyRead.includes('/home/me'));
check('fence re-exposes the project', fenced.allowRead.includes(cwd));
check('fence re-exposes allowWrite roots', fenced.allowRead.includes('/tmp') && fenced.allowRead.includes('.'));
check('fence re-exposes outsideProject.allowRead', fenced.allowRead.includes('/srv/shared'));
check('fence keeps the hard deny list', fenced.denyRead.includes('~/.ssh') && fenced.denyRead.includes('~/.pi/agent'));
check('fence does not re-expose the agent dir', !fenced.allowRead.some((p) => p.includes('.pi/agent')));
check('fence never denies /', !fenced.denyRead.includes('/'));

// --- edge: project directly under / (parent would be /) ---
const atRoot = sandboxFilesystem(ask, { cwd: '/proj', home: '/root' });
check('parent / is not fenced', !atRoot.denyRead.includes('/'));
check('home is still fenced', atRoot.denyRead.includes('/root'));
check('project under / is re-exposed', atRoot.allowRead.includes('/proj'));

// --- ADR-015: pre-flight read candidates (Layer 1 bash ask) ---
// `yes` makes existence deterministic; hard-denied paths are still excluded.
const gate = fs({ denyRead: ['~/.ssh'], outsideProject: { read: 'ask', allowRead: ['/srv/shared'] } });
const yes = () => true;
const cand = (cmd, exists = yes) => outsideProjectReadCandidates(cmd, cwd, home, gate, exists);
check('preflight: ls absolute outside dir', cand('ls -la /home/me/.pi/agent/').join() === '/home/me/.pi/agent');
check('preflight: cat ~ path', cand('cat ~/.bashrc').join() === '/home/me/.bashrc');
check('preflight: find outside dir', cand('find /home/me/.pi/agent -type f').join() === '/home/me/.pi/agent');
check('preflight: project path is not gated', cand('ls ./src').length === 0);
check('preflight: allowWrite root is not gated', cand('ls /tmp/x').length === 0);
check('preflight: outsideProject.allowRead is not gated', cand('ls /srv/shared/x').length === 0);
check('preflight: hard denyRead is never a candidate', cand('cat ~/.ssh/id_rsa').length === 0);
check('preflight: non-read command is ignored', cand('echo ~/.pi/agent').length === 0);
check('preflight: nonexistent path is ignored', cand('cat /nope/x', () => false).length === 0);
check('preflight: cd segment is inspected', cand('cd ~/.pi/agent && ls').join() === '/home/me/.pi/agent');
check('preflight: mode allow never asks', outsideProjectReadCandidates('ls /home/me/.pi/agent', cwd, home, fs(), yes).length === 0);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
