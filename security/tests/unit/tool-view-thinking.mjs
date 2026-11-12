import { hiddenThinkingLabel } from '../../../src/core/tool-view/thinking.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

check('compact draws a thought as its own one line', hiddenThinkingLabel('compact') === '~ Thought — click to read');
check('compact never keeps Pi\'s Thinking... label', hiddenThinkingLabel('compact') !== 'Thinking...');
check('full leaves the label to Pi', hiddenThinkingLabel('full') === undefined);
check('an unknown view leaves the label to Pi', hiddenThinkingLabel('rows') === undefined);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
