import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const scratchAgentDir = mkdtempSync(join(tmpdir(), 'tool-view-agent-'));
process.env.PI_CODING_AGENT_DIR = scratchAgentDir;

const settingsFilePath = join(scratchAgentDir, 'tool-view.json');
const extension = await import('../../../extensions/tool-view.ts');

const registered = { resolvers: [], commands: [], handlers: [], events: [] };
const pi = {
	on: (event) => { registered.events.push(event); return () => {}; },
	registerToolRenderer: (resolver) => { registered.resolvers.push(resolver); },
	registerCommand: (name, options) => { registered.commands.push(name); registered.handlers.push(options.handler); },
};

extension.default(pi);

check('one renderer resolver is registered', registered.resolvers.length === 1);
check('the command is tool-view', registered.commands.length === 1 && registered.commands[0] === 'tool-view');
check('one command handler is registered', registered.handlers.length === 1);
check('session_start is handled', registered.events.includes('session_start'));
check('session_shutdown is handled', registered.events.includes('session_shutdown'));

const resolver = registered.resolvers[0];
const handsBackToPi = (toolName) => resolver(toolName, () => 'pi-renderers') === 'pi-renderers';
check('owns bash', !handsBackToPi('bash'));
check('owns read', !handsBackToPi('read'));
check('hands write back to Pi', handsBackToPi('write'));
check('hands an MCP tool back to Pi', handsBackToPi('mcp__docs__search'));
check('hands an unknown tool back to Pi', handsBackToPi('some-future-tool'));

const contextFor = (mode, notices) => ({
	mode,
	ui: { notify: (message) => notices.push(message), select: async () => undefined },
});

const printNotices = [];
await registered.handlers[0]('compact', contextFor('print', printNotices));
check('a non-TUI mode gets a notice', printNotices.length === 1);
check('the notice names the settings file', printNotices[0].includes('tool-view.json'));
check('a non-TUI mode writes no settings', !existsSync(settingsFilePath));

await registered.handlers[0]('compact', contextFor('tui', []));
check('compact is written', existsSync(settingsFilePath));
check('the saved view is compact', JSON.parse(readFileSync(settingsFilePath, 'utf-8')).view === 'compact');

await registered.handlers[0]('full', contextFor('tui', []));
check('full is written', JSON.parse(readFileSync(settingsFilePath, 'utf-8')).view === 'full');

const usageNotices = [];
await registered.handlers[0]('rows', contextFor('tui', usageNotices));
check('an unknown argument explains the usage', usageNotices.length === 1 && usageNotices[0].includes('/tool-view compact'));
check('an unknown argument keeps the saved view', JSON.parse(readFileSync(settingsFilePath, 'utf-8')).view === 'full');

const menuNotices = [];
await registered.handlers[0]('', contextFor('tui', menuNotices));
check('a cancelled menu changes nothing', menuNotices.length === 0);

rmSync(scratchAgentDir, { recursive: true, force: true });

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
