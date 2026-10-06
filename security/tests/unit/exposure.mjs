// Advanced Secure output gate: any tool output (bash `cat`, read, grep, MCP) is
// scanned before the model sees it.
import { collectExposure } from '../../../src/l2-guard/exposure.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

const cat = [
  'DB_HOST=localhost',
  'key=asdfadsdaasdfdsafasdf',
  'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789',
  'DB_PORT=5432',
].join('\n');
const r = collectExposure([{ type: 'text', text: cat }], 'bash');
check('cat output is flagged', r.types.length >= 1);
check('cat output reports SECRET_ASSIGNMENT', r.types.includes('SECRET_ASSIGNMENT'));
check('the block starts with the subject', r.hits[0].startsWith('bash\n'));
check('the first detected line is shown', r.hits[0].includes('2: key=asdfadsdaasdfdsafasdf'));
check('the second detected line is shown', r.hits[0].includes('3: OPENAI_API_KEY='));

check('clean output is not flagged', collectExposure([{ type: 'text', text: 'hello world\nall good' }], 'bash').types.length === 0);
check('image blocks are ignored', collectExposure([{ type: 'image' }], 'bash').types.length === 0);

const many = Array.from({ length: 12 }, (_, i) => `key=secret${i}asdfghjklqwerty`).join('\n');
const capped = collectExposure([{ type: 'text', text: many }], 'bash');
check('at most 8 lines are listed', capped.hits[0].split('\n').length === 9);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
