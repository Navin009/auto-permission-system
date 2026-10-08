// Advanced Secure output gate: any tool output (bash `cat`, read, grep, MCP) is
// scanned before the model sees it.
import { collectExposure } from '../../../src/l2-guard/exposure.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };
const ELL = '\u2026';

const cat = [
	'#!/bin/bash',
	'# deploy helper',
	'',
	'DB_HOST=localhost',
	'key=asdfadsdaasdfdsafasdf',
	'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789',
	'DB_PORT=5432',
	'',
	'echo "ready"',
].join('\n');
const r = collectExposure([{ type: 'text', text: cat }], 'bash: cat deploy.sh');
check('cat output is flagged', r.types.length >= 1);
check('cat output reports SECRET_ASSIGNMENT', r.types.includes('SECRET_ASSIGNMENT'));
check('block starts with "From     <subject>"', r.hits[0].startsWith('From     bash: cat deploy.sh\n'));
check('first matched line shown', r.hits[0].includes('5: key=asdfadsdaasdfdsafasdf'));
check('second matched line shown', r.hits[0].includes('6: OPENAI_API_KEY='));
check('leading ' + ELL + ' when output exists before first match', r.hits[0].includes('        ' + ELL + '\n5:'));
check('trailing ' + ELL + ' when output exists after last match', r.hits[0].endsWith(ELL));

check('clean output is not flagged', collectExposure([{ type: 'text', text: 'hello world\nall good' }], 'bash').types.length === 0);
check('image blocks are ignored', collectExposure([{ type: 'image' }], 'bash').types.length === 0);

const many = Array.from({ length: 12 }, (_, i) => `key=secret${i}asdfghjklqwerty`).join('\n');
const capped = collectExposure([{ type: 'text', text: many }], 'bash');
const matchedLines = capped.hits[0].split('\n').filter((l) => /^\d+:/.test(l));
check('matched lines capped at 8', matchedLines.length === 8);
check('cap produces trailing ' + ELL, capped.hits[0].endsWith(ELL));

const readKind = collectExposure([{ type: 'text', text: cat }], '/etc/foo');
check('read-tool subject passes through', readKind.hits[0].startsWith('From     /etc/foo\n'));
const bashOnly = collectExposure([{ type: 'text', text: cat }], 'bash');
check('bare "bash" subject (no command)', bashOnly.hits[0].startsWith('From     bash\n'));

const edgeMatch = ['KEY=topsecretvalue1', 'plain footer', 'KEY=topsecretvalue2'].join('\n');
const edge = collectExposure([{ type: 'text', text: edgeMatch }], 'bash');
check('no leading ' + ELL + ' when first match is line 1', !edge.hits[0].split('\n')[1].match(/^\s*\u2026$/));
check('no trailing ' + ELL + ' when last match is final line', !edge.hits[0].endsWith(ELL));

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);