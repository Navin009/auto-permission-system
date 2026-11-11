import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	DEFAULT_TOOL_VIEW_SETTINGS,
	normalizeToolViewSettings,
	readToolViewSettings,
	writeToolViewMode,
} from '../../../src/core/tool-view/settings.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

check('default view is full', DEFAULT_TOOL_VIEW_SETTINGS.viewMode === 'full');
check('missing settings normalize to the default', normalizeToolViewSettings(undefined).viewMode === 'full');
check('a null settings object is the default', normalizeToolViewSettings(null).viewMode === 'full');
check('a string is the default', normalizeToolViewSettings('compact').viewMode === 'full');
check('compact is read', normalizeToolViewSettings({ view: 'compact' }).viewMode === 'compact');
check('full is read', normalizeToolViewSettings({ view: 'full' }).viewMode === 'full');
check('an unknown view falls back to full', normalizeToolViewSettings({ view: 'rows' }).viewMode === 'full');
check('case must match', normalizeToolViewSettings({ view: 'Compact' }).viewMode === 'full');
check('a numeric view falls back', normalizeToolViewSettings({ view: 1 }).viewMode === 'full');

const scratch = mkdtempSync(join(tmpdir(), 'tool-view-settings-'));
const settingsPath = join(scratch, 'nested', 'tool-view.json');

check('a missing file is the default view', readToolViewSettings(settingsPath).viewMode === 'full');
check('writing a view reports no error', writeToolViewMode(settingsPath, 'compact') === null);
check('the written view reads back', readToolViewSettings(settingsPath).viewMode === 'compact');

writeFileSync(settingsPath, '{ not json');
check('an unparsable file is the default view', readToolViewSettings(settingsPath).viewMode === 'full');
check('writing over an unparsable file still works', writeToolViewMode(settingsPath, 'compact') === null);
check('the recovered file reads back', readToolViewSettings(settingsPath).viewMode === 'compact');

writeFileSync(settingsPath, JSON.stringify({ view: 'compact', unrelated: 7 }));
writeToolViewMode(settingsPath, 'full');
check('an unknown key survives a write', readToolViewSettings(settingsPath).viewMode === 'full');

writeFileSync(settingsPath, JSON.stringify({ view: 'compact' }));
check('switching back to compact', writeToolViewMode(settingsPath, 'compact') === null);
check('compact reads back again', readToolViewSettings(settingsPath).viewMode === 'compact');

rmSync(scratch, { recursive: true, force: true });

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
