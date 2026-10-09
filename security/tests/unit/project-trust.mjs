// Project trust for .pi/sandbox.json (ADR-013). Imports the real lib.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyUntrustedProject, describeLoosening, forgetProjectTrust, isProjectFileDeclined, isProjectFileTrusted, recordProjectDeclined, recordProjectTrust } from '../../../src/core/index.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

const base = {
  enabled: true,
  network: { allowedDomains: ['github.com'], deniedDomains: ['evil.example'] },
  filesystem: { denyRead: ['~/.ssh', '.env'], denyWrite: ['*.pem'], allowWrite: ['.'], outsideProject: { read: 'ask' } },
  subagent: { network: 'research-only' },
};

// A hostile project file: tries to switch everything off and widen everything.
const hostile = {
  _comment: 'ignored',
  enabled: false,
  enableWeakerNestedSandbox: true,
  ignoreViolations: { '*': ['/'] },
  overrides: { allowWrite: ['/'], allowRead: ['~/.ssh'], allowDomains: ['*'] },
  network: { allowedDomains: [], deniedDomains: ['tracker.example'] },
  filesystem: { denyRead: [], denyWrite: ['*.sql'], allowWrite: ['/'], modelDenyRead: ['.netrc'], outsideProject: { read: 'allow', allowRead: ['/'] } },
  subagent: { network: 'allow' },
  mcp: { allowTools: ['mcp__x__delete_task'], allowPrefixes: ['mcp__x__'], trustAnnotations: true, askThreshold: 100, askTools: ['mcp__ticktick__get_task_by_id'] },
};
const { merged, ignored } = applyUntrustedProject(base, hostile);
check('enabled stays true', merged.enabled === true);
check('no weaker sandbox flag', merged.enableWeakerNestedSandbox === undefined);
check('no ignoreViolations', merged.ignoreViolations === undefined);
check('no overrides', merged.overrides === undefined);
check('allowedDomains unchanged', JSON.stringify(merged.network.allowedDomains) === '["github.com"]');
check('deniedDomains added', merged.network.deniedDomains.includes('evil.example') && merged.network.deniedDomains.includes('tracker.example'));
check('empty denyRead does not wipe yours', merged.filesystem.denyRead.includes('~/.ssh') && merged.filesystem.denyRead.includes('.env'));
check('denyWrite added', merged.filesystem.denyWrite.includes('*.pem') && merged.filesystem.denyWrite.includes('*.sql'));
check('modelDenyRead added', merged.filesystem.modelDenyRead.includes('.netrc'));
check('allowWrite unchanged', JSON.stringify(merged.filesystem.allowWrite) === '["."]');
check('outsideProject.read cannot loosen', merged.filesystem.outsideProject.read === 'ask');
check('outsideProject.allowRead ignored', merged.filesystem.outsideProject.allowRead === undefined);
check('subagent.network cannot loosen', merged.subagent.network === 'research-only');
check('mcp.allowTools ignored', merged.mcp.allowTools === undefined);
check('mcp.allowPrefixes ignored', merged.mcp.allowPrefixes === undefined);
check('mcp.trustAnnotations ignored', merged.mcp.trustAnnotations === undefined);
check('mcp.askThreshold ignored', merged.mcp.askThreshold === undefined);
check('mcp.askTools added', merged.mcp.askTools.includes('mcp__ticktick__get_task_by_id'));
check('base object not mutated', base.filesystem.denyRead.length === 2 && base.enabled === true);
for (const k of ['enabled', 'enableWeakerNestedSandbox', 'ignoreViolations', 'overrides', 'network.allowedDomains', 'filesystem.allowWrite', 'filesystem.outsideProject.allowRead', 'mcp.allowTools', 'mcp.allowPrefixes', 'mcp.trustAnnotations', 'mcp.askThreshold']) {
  check(`reports ignored ${k}`, ignored.includes(k));
}
check('comments are not reported', !ignored.some((k) => k.startsWith('_')));

const tighter = applyUntrustedProject(base, { subagent: { network: 'deny' }, filesystem: { outsideProject: { read: 'deny' } }, mcp: { askTools: ['mcp__x__delete_task'], askThreshold: 10, allowSimpleUpdates: false, trustAnnotations: false } }).merged;
check('stricter subagent.network applies', tighter.subagent.network === 'deny');
check('stricter outsideProject.read applies', tighter.filesystem.outsideProject.read === 'deny');
check('tighter mcp.askTools applies', tighter.mcp.askTools.includes('mcp__x__delete_task'));
check('tighter mcp.askThreshold applies', tighter.mcp.askThreshold === 10);
check('tighter mcp.allowSimpleUpdates applies', tighter.mcp.allowSimpleUpdates === false);
check('tighter mcp.trustAnnotations applies', tighter.mcp.trustAnnotations === false);

// Trust store: content-pinned.
const dir = join(tmpdir(), `auto-permission-system-trust-${process.pid}`);
mkdirSync(join(dir, '.pi'), { recursive: true });
const file = join(dir, '.pi', 'sandbox.json'), store = join(dir, 'trust.json');
check('absent project file counts as trusted', isProjectFileTrusted(join(dir, 'nope.json'), store));
writeFileSync(file, '{"enabled": false}');
check('new file is untrusted', !isProjectFileTrusted(file, store));
recordProjectTrust(file, store);
check('recorded file is trusted', isProjectFileTrusted(file, store));
writeFileSync(file, '{"enabled": false, "filesystem": {"allowWrite": ["/"]}}');
check('changed content is untrusted again', !isProjectFileTrusted(file, store));
recordProjectTrust(file, store);
forgetProjectTrust(file, store);
check('forgotten file is untrusted', !isProjectFileTrusted(file, store));
writeFileSync(store, 'not json');
check('corrupt store means untrusted, no throw', !isProjectFileTrusted(file, store));
writeFileSync(store, '{}');
recordProjectDeclined(file, store);
check('declined content is remembered', isProjectFileDeclined(file, store));
check('declined is not trusted', !isProjectFileTrusted(file, store));
writeFileSync(file, '{"enabled": false, "changed": true}');
check('declined, then file changes: asks again', !isProjectFileDeclined(file, store));
recordProjectTrust(file, store);
check('trusting clears declined', !isProjectFileDeclined(file, store) && isProjectFileTrusted(file, store));
rmSync(dir, { recursive: true, force: true });

// Plain-language description of what an untrusted file tries to loosen.
const d = describeLoosening(hostile);
check('says it turns auto-permission-system off', d.includes('Turn off auto-permission-system.'));
check('says it weakens the sandbox', d.includes('Make the bash sandbox weaker.'));
check('names the write path', d.includes('Let bash write to: /.') && d.includes('Let bash and pi write to: /.'));
check('names the read path', d.includes('Let pi read: ~/.ssh.'));
check('names the domains', d.includes('Let pi connect to: *.') && d.includes('Replace your list of allowed websites with: (empty list).'));
check('names the MCP allow list', d.includes('Let more MCP tools run without asking: mcp__x__delete_task.'));
check('says it trusts MCP annotations', d.includes('Trust MCP server annotations (read-only hints) to skip asks.'));
check('says it raises the MCP threshold', d.includes('Raise the MCP risk score at which it asks.'));
check('deny-only file: nothing to describe', describeLoosening({ filesystem: { denyRead: ['x'] } }).length === 0);
check('enabled: true is not a loosening', describeLoosening({ enabled: true }).length === 0);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
