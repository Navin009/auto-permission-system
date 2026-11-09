// Advanced Secure output gate: any tool output (bash `cat`, read, grep, MCP) is
// scanned before the model sees it.
import { collectExposure } from '../../../src/l2-guard/exposure.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

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
check('block starts with "Tool     <subject>"', r.hits[0].startsWith('Tool     bash: cat deploy.sh\n'));
check('first matched line shown with line number', r.hits[0].includes('Finding  5: key=asdfadsdaasdfdsafasdf'));
check('second matched line shown with line number', r.hits[0].includes('Finding  6: OPENAI_API_KEY='));
check('no ellipsis markers', !r.hits[0].includes('\u2026'));

check('clean output is not flagged', collectExposure([{ type: 'text', text: 'hello world\nall good' }], 'bash').types.length === 0);
check('image blocks are ignored', collectExposure([{ type: 'image' }], 'bash').types.length === 0);

const many = Array.from({ length: 12 }, (_, i) => `key=secret${i}asdfghjklqwerty`).join('\n');
const capped = collectExposure([{ type: 'text', text: many }], 'bash');
const matchedLines = capped.hits[0].split('\n').filter((l) => /^Finding  \d+:/.test(l));
check('one Finding row per detected line', matchedLines.length >= 1);
check('every Finding row carries its own line number', matchedLines.every((l) => /^Finding  \d+: /.test(l)));

const readKind = collectExposure([{ type: 'text', text: cat }], '/etc/foo');
check('read-tool subject passes through', readKind.hits[0].startsWith('Tool     /etc/foo\n'));
const bashOnly = collectExposure([{ type: 'text', text: cat }], 'bash');
check('bare "bash" subject (no command)', bashOnly.hits[0].startsWith('Tool     bash\n'));

const edgeMatch = ['KEY=topsecretvalue1', 'plain footer', 'KEY=topsecretvalue2'].join('\n');
const edge = collectExposure([{ type: 'text', text: edgeMatch }], 'bash');
check('first Finding row is line 1', edge.hits[0].split('\n')[1].startsWith('Finding  1: '));
check('last Finding row is line 3', edge.hits[0].split('\n').some((l) => l.startsWith('Finding  3: ')));

const proxyUrl = 'http://srt.cHMgYXV4IHWgZ3JlcCbub2Rl:s3cr3tPr0xyV4lue@localhost:3128';
const longLine = `navinku+  1264  0.0  0.0   3932  1264 ? Ss 11:48 0:00 bwrap ${Array.from({ length: 40 }, (_, i) => `--setenv PROXY_${i} ${proxyUrl}`).join(' ')} --ro-bind / / -- java -jar /tmp/srt-proxy-agent.jar`;
const long = collectExposure([{ type: 'text', text: longLine }], 'bash (ps aux | grep node)');
const longRows = long.hits[0].split('\n').slice(1);
check('long single-line output is flagged', long.types.includes('URL_CREDENTIAL'));
check('every evidence row is complete (the selector scrolls it)', longRows.length === 1 && longRows[0].includes(longLine.trim()));
check('no row is clipped with an ellipsis', !long.hits[0].includes('\u2026'));

const queryOnly = ['// fetch helper', 'await fetch(`/api/orders?token=abcdef123456`)'].join('\n');
const query = collectExposure([{ type: 'text', text: queryOnly }], 'rg');
check('query credential is flagged', query.types.includes('URL_CREDENTIAL'));
check('query credential locates its line', query.hits[0].includes('Finding  2: '));
check('prompt is never contentless when a finding exists', query.hits.length === 1 && query.hits[0].includes('Tool     rg'));

const manyLines = Array.from({ length: 40 }, (_, i) => `key=Xk9pQ2mN7vR4tY8wZ1aB3cD6eF0gH5j${i}`).join('\n');
const manyResult = collectExposure([{ type: 'text', text: manyLines }], 'bash');
const manyRows = manyResult.hits[0].split('\n').filter((l) => l.startsWith('Finding  '));
check('every detected line gets its own row', manyRows.length === 40);
check('no detected line is dropped', !manyResult.hits[0].includes('not shown'));

const crlf = 'DB_HOST=localhost\r\nkey=asdfadsdaasdfdsafasdf\r\nDB_PORT=5432\r\n';
const crlfResult = collectExposure([{ type: 'text', text: crlf }], 'bash');
const crlfRows = crlfResult.hits[0].split('\n').filter((l) => l.startsWith('Finding  '));
check('CRLF output reports only the detected line', crlfRows.length === 1 && crlfRows[0].startsWith('Finding  2: '));

console.log(`PASS=${pass}, FAIL=${fail}`);
