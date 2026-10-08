// Program-id detection for the Advanced Secure output gate. Drives
// bashBinary, mcpServer, programIdForToolCall directly \u2014 no pi, no fs.
import { bashBinary, mcpServer, programIdForToolCall } from '../../../src/l2-guard/program-id.ts';

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

// --- mcpServer ---
check('mcpServer: composio', mcpServer('mcp__composio__search') === 'composio');
check('mcpServer: composio_io (underscores allowed in server)', mcpServer('mcp__composio_io__search') === 'composio_io');
check('mcpServer: tool has underscores too', mcpServer('mcp__composio__search_query') === 'composio');
check('mcpServer: non-mcp returns undefined', mcpServer('bash') === undefined);
check('mcpServer: malformed returns undefined', mcpServer('mcp_composio_search') === undefined);
check('mcpServer: empty returns undefined', mcpServer('') === undefined);

// --- programIdForToolCall ---
check('programId: bash + composio', programIdForToolCall('bash', { command: 'composio search googleads' }) === 'composio');
check('programId: bash + sudo gcloud', programIdForToolCall('bash', { command: 'sudo gcloud auth print-access-token' }) === 'gcloud');
check('programId: bash + env-prefixed aws', programIdForToolCall('bash', { command: 'AWS_PROFILE=prod aws s3 ls' }) === 'aws');
check('programId: mcp__composio__search', programIdForToolCall('mcp__composio__search', {}) === 'composio');
check('programId: mcp__composio_io__search', programIdForToolCall('mcp__composio_io__search', {}) === 'composio_io');
check('programId: generic tool falls back to tool name', programIdForToolCall('read', { path: '/etc/foo' }) === 'read');
check('programId: bash without command', programIdForToolCall('bash', {}) === 'bash');
check('programId: empty toolName returns undefined', programIdForToolCall('', { command: 'x' }) === undefined);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);