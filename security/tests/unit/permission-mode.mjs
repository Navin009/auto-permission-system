// Permission mode: normalize, label, untrusted-project merge, and persistence.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeMode, modeLabel, DEFAULT_MODE, applyUntrustedProject, setPolicyMode } from '../../../src/core/index.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

check('absent mode falls back to default', normalizeMode(undefined) === 'default');
check('unknown mode falls back to default', normalizeMode('Advanced-Secure') === 'default');
check('the exact value passes through', normalizeMode('advanced-secure') === 'advanced-secure');
check('default label', modeLabel('default') === 'Default');
check('advanced label', modeLabel('advanced-secure') === 'Advanced Secure');
check('DEFAULT_MODE is default', DEFAULT_MODE === 'default');

const up = applyUntrustedProject({ enabled: true, mode: 'default' }, { mode: 'advanced-secure' });
check('an untrusted project may upgrade the mode', up.merged.mode === 'advanced-secure');
check('an upgrade is not reported as loosening', !up.ignored.includes('mode'));

const down = applyUntrustedProject({ enabled: true, mode: 'advanced-secure' }, { mode: 'default' });
check('an untrusted project may not downgrade the mode', down.merged.mode === 'advanced-secure');
check('a downgrade is reported as loosening', down.ignored.includes('mode'));

const dir = mkdtempSync(join(tmpdir(), 'aps-mode-'));
const file = join(dir, 'sandbox.json');
writeFileSync(file, JSON.stringify({ enabled: true, network: { allowedDomains: ['example.com'] } }));
setPolicyMode(file, 'advanced-secure');
const written = JSON.parse(readFileSync(file, 'utf-8'));
check('setPolicyMode writes the mode', written.mode === 'advanced-secure');
check('setPolicyMode preserves other fields', written.enabled === true && written.network.allowedDomains[0] === 'example.com');
setPolicyMode(file, 'default');
check('setPolicyMode can turn it back off', JSON.parse(readFileSync(file, 'utf-8')).mode === 'default');

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
