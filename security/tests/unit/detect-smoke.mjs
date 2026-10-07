// Vendored detection cores: filename gate, content scanner, MCP gate, output gate.
import { classifyFilename, scanTextContent, evaluateMcpCall, scanToolOutput } from '../../../src/detect/index.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

check('a .env name is strong risk', classifyFilename('/home/me/.env').risk === 'strong');
check('an SSH key name is strong risk', classifyFilename('/home/me/.ssh/id_rsa').risk === 'strong');
check('a plain source file is not a candidate', classifyFilename('/home/me/app.ts').candidate === false);

const s = scanTextContent('OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789');
check('content scan finds the assignment', s.findings.length >= 1);
check('content scan scores above the ask threshold', s.riskScore >= 30);

const o = scanToolOutput({ output: 'password=supersecret123456789' });
check('output gate asks', o.decision === 'ask');
check('output gate redacts the value', typeof o.redactedOutput === 'string' && o.redactedOutput.includes('REDACTED') && !o.redactedOutput.includes('supersecret123456789'));

const del = evaluateMcpCall({ tool: { name: 'delete_database', description: 'Delete the database' }, call: { name: 'delete_database', arguments: {} } });
check('destructive MCP call asks', del.decision === 'ask');
check('destructive MCP call is classified destructive', del.classification === 'destructive');

const ro = evaluateMcpCall({ tool: { name: 'list_files', description: 'List files', annotations: { readOnlyHint: true } }, call: { name: 'list_files', arguments: {} }, policy: { trustAnnotations: true } });
check('trusted read-only MCP call allows', ro.decision === 'allow');

// Weak `key`: a random value asks; a placeholder value does not.
const keyRandom = scanTextContent('key=asdfadsdaasdfdsafasdf');
check('key=<random> is flagged', keyRandom.findings.length >= 1 && keyRandom.riskScore >= 30);
check('key=Xk9pQ2… is flagged', scanTextContent('key=Xk9pQ2mN7vR4tY8wZ1aB3cD6eF0gH5jL').findings.length >= 1);
check('key=value stays clean', scanTextContent('key=value').findings.length === 0);
check('key=somevalue stays clean', scanTextContent('key=somevalue').findings.length === 0);
check('a repeated value stays clean', scanTextContent('key=aaaaaaaa').findings.length === 0);
check('a lookalike key name stays clean', scanTextContent('monkey=asdfadsdaasdfdsafasdf').findings.length === 0);
check('output gate asks on key=<random>', scanToolOutput({ output: 'key=asdfadsdaasdfdsafasdf' }).decision === 'ask');

// `key` is also an everyday field name: code and identifiers stay clean.
check('a namespaced JSON key value stays clean', scanTextContent('"key": "subagent.network"').findings.length === 0);
check('a template-literal key value stays clean', scanTextContent('const key = \`${kind}:${subject}\`;').findings.length === 0);
check('a method-call key value stays clean', scanTextContent('const key = rawKey.normalize("NFKC").toLowerCase();').findings.length === 0);
check('an index-access key value stays clean', scanTextContent('const key = tokens[index];').findings.length === 0);
check('a snake_case key value stays clean', scanTextContent('"key": "customer_id"').findings.length === 0);
check('a camelCase key value stays clean', scanTextContent('key=primaryKey').findings.length === 0);
check('an arrow function is not an assignment', scanTextContent('return xs.some((token) => TOKENS.has(token));').findings.length === 0);
check('a two-word label stays clean', scanTextContent('PRIVATE_KEY: "private key"').findings.length === 0);
check('a quoted random key value still flags', scanTextContent('key="Xk9pQ2mN7vR4tY8wZ1aB3cD6eF0gH5jL"').findings.length >= 1);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
