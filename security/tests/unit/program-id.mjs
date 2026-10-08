// Program-id detection for the Advanced Secure output gate. Drives
// bashBinary, mcpServer, programIdForToolCall directly \u2014 no pi, no fs.
import { bashBinary, programIdForToolCall } from '../../../src/l2-guard/program-id.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

// --- bashBinary ---
check('bashBinary: simple command', bashBinary('composio search googleads') === 'composio');
check('bashBinary: cat', bashBinary('cat /etc/foo') === 'cat');
check('bashBinary: full path', bashBinary('/usr/local/bin/composio search') === '/usr/local/bin/composio');
check('bashBinary: strips sudo', bashBinary('sudo tee /etc/foo') === 'tee');
check('bashBinary: strips sudo + env', bashBinary('FOO=bar sudo composio search') === 'composio');
check('bashBinary: strips multiple env', bashBinary('A=1 B=2 gcloud auth print-access-token') === 'gcloud');
check('bashBinary: strips command builtin', bashBinary('command -v composio') === 'composio');
check('bashBinary: strips nice', bashBinary('nice -n 10 aws s3 ls') === 'aws');
check('bashBinary: strips time', bashBinary('time kubectl get pods') === 'kubectl');
check('bashBinary: empty returns undefined', bashBinary(undefined) === undefined);
check('bashBinary: whitespace-only returns undefined', bashBinary('   ') === undefined);
check('bashBinary: env-only returns undefined', bashBinary('FOO=bar') === undefined);

// --- mcpServer was removed: MCP tools don't get the per-program session grant ---
// (Program id detection is bash-only. MCP and other tools return undefined so the
// Advanced Secure output gate doesn't offer them a per-program row.)

// --- programIdForToolCall ---
check('programId: bash + composio', programIdForToolCall('bash', { command: 'composio search googleads' }) === 'composio');
check('programId: bash + sudo gcloud', programIdForToolCall('bash', { command: 'sudo gcloud auth print-access-token' }) === 'gcloud');
check('programId: bash + env-prefixed aws', programIdForToolCall('bash', { command: 'AWS_PROFILE=prod aws s3 ls' }) === 'aws');
check('programId: mcp__composio__search returns undefined (MCP excluded)', programIdForToolCall('mcp__composio__search', {}) === undefined);
check('programId: mcp__composio_io__search returns undefined (MCP excluded)', programIdForToolCall('mcp__composio_io__search', {}) === undefined);
check('programId: read tool returns undefined', programIdForToolCall('read', { path: '/etc/foo' }) === undefined);
check('programId: bash without command returns undefined', programIdForToolCall('bash', {}) === undefined);
check('programId: empty toolName returns undefined', programIdForToolCall('', { command: 'x' }) === undefined);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);