// Output gate: a data block is reported as unscannable instead of forwarded (ADR-018, ADR-042).
import { collectExposure } from '../../../src/l2-guard/exposure.ts';

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { if (cond) pass++; else { fail++; console.log("FAIL:", name, "→", extra); } };

const image = { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUg' };
const secretText = { type: 'text', text: 'API_KEY=abcd1234efgh5678ijkl9012' };
const cleanText = { type: 'text', text: 'src/app.ts:12:  const total = sum(a, b)' };

const flagged = collectExposure([image], 'bash (screenshot)', { flagNonText: true });
check('a data block is flagged when the caller asks', flagged.types.includes('NON_TEXT_OUTPUT'));
check('a flagged data block yields a prompt row', flagged.hits.length === 1 && flagged.hits[0].includes('not scannable'));
check('the prompt row names the payload type', flagged.hits[0].includes('image/png'));

const exempt = collectExposure([image], 'read (/tmp/shot.png)', { flagNonText: false });
check('the read tool is exempt (it returns images on purpose)', exempt.types.length === 0 && exempt.hits.length === 0);

const defaulted = collectExposure([image], 'bash (screenshot)');
check('no options means no flag (old callers unchanged)', defaulted.types.length === 0);

const empty = collectExposure([{ type: 'image', data: '' }], 'bash', { flagNonText: true });
check('an empty data block is not a payload', empty.types.length === 0);

check('text scanning is unchanged', collectExposure([secretText], 'bash (cat .env)').types.length > 0);
check('clean text stays clean', collectExposure([cleanText], 'grep', { flagNonText: true }).types.length === 0);

const mixed = collectExposure([cleanText, image], 'mcp__shot__capture', { flagNonText: true });
check('a mixed result reports the data block', mixed.types.length === 1 && mixed.hits.length === 1);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
