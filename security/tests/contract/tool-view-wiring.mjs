import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Text } from '@earendil-works/pi-tui';
import { setActiveViewMode } from '../../../src/tool-view/session.ts';
import { resetCommandGroups } from '../../../src/tool-view/command-groups.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const scratchAgentDir = mkdtempSync(join(tmpdir(), 'tool-view-agent-'));
process.env.PI_CODING_AGENT_DIR = scratchAgentDir;

const settingsFilePath = join(scratchAgentDir, 'tool-view.json');
const extension = await import('../../../extensions/tool-view.ts');

const registered = { resolvers: [], commands: [], handlers: [], events: [], eventHandlers: new Map() };
const pi = {
	on: (event, handler) => { registered.events.push(event); registered.eventHandlers.set(event, handler); return () => {}; },
	registerToolRenderer: (resolver) => { registered.resolvers.push(resolver); },
	registerCommand: (name, options) => { registered.commands.push(name); registered.handlers.push(options.handler); },
};

extension.default(pi);

check('one renderer resolver is registered', registered.resolvers.length === 1);
check('the command is tool-view', registered.commands.length === 1 && registered.commands[0] === 'tool-view');
check('one command handler is registered', registered.handlers.length === 1);
check('session_start is handled', registered.events.includes('session_start'));
check('session_shutdown is handled', registered.events.includes('session_shutdown'));
check('turn_end is handled', registered.events.includes('turn_end'));
check('a turn boundary alone no longer closes a group', !registered.events.includes('turn_start'));
check('a user message closes a command group', registered.events.includes('message_start'));

const resolver = registered.resolvers[0];
const handsBackToPi = (toolName) => resolver(toolName, () => 'pi-renderers') === 'pi-renderers';
check('owns bash', !handsBackToPi('bash'));
check('leaves read to Pi', handsBackToPi('read'));
check('leaves edit to Pi', handsBackToPi('edit'));
check('leaves codemode to Pi', handsBackToPi('codemode'));
check('hands write back to Pi', handsBackToPi('write'));
check('hands an MCP tool back to Pi', handsBackToPi('mcp__docs__search'));
check('hands an unknown tool back to Pi', handsBackToPi('some-future-tool'));

const theme = { fg: (color, text) => text };
const fallbackRenderers = { renderShell: 'default', renderCall: () => new Text('pi-block'), renderResult: () => new Text('pi-block') };
const renderContext = (overrides) => ({
	args: {},
	toolCallId: 'call-1',
	invalidate: () => {},
	lastComponent: undefined,
	state: {},
	cwd: '/work/project',
	executionStarted: true,
	argsComplete: true,
	isPartial: false,
	expanded: false,
	showImages: false,
	isError: false,
	durationMs: undefined,
	outputPad: 1,
	keyText: () => 'ctrl+o',
	keyHint: () => 'ctrl+o to expand',
	...overrides,
});
const renderCommands = (commands) =>
	commands.map(([toolCallId, command]) =>
		resolver('bash', () => fallbackRenderers)
			.renderCall({ command }, theme, renderContext({ toolCallId, args: { command } }))
			.render(100),
	);

resetCommandGroups();
setActiveViewMode('compact');
const [firstGroup, secondGroup] = renderCommands([['call-a', 'ls'], ['call-b', 'pwd']]);
check('a shell call opens a one-command row', firstGroup.join(' ').includes('Running 1 command'));
check('a following shell call joins it silently', secondGroup.length === 0);

const endTurn = (content) => registered.eventHandlers.get('turn_end')({ message: { role: 'assistant', content } });
endTurn([{ type: 'toolCall', id: 'call-b', name: 'bash' }]);
const [afterToolOnlyTurn] = renderCommands([['call-turn', 'git diff']]);
check('a tool-only turn keeps the group open', afterToolOnlyTurn.length === 0);

endTurn([{ type: 'text', text: 'Here is what I found.' }]);
const [afterProseTurn] = renderCommands([['call-prose', 'git status']]);
check('an assistant reply with text closes the group', afterProseTurn.join(' ').includes('Running 1 command'));

resolver('read', () => fallbackRenderers);
const [afterRead] = renderCommands([['call-c', 'git status']]);
check('a non-shell call ends the group', afterRead.join(' ').includes('Running 1 command'));

resolver('write', () => fallbackRenderers);
const [afterWrite] = renderCommands([['call-d', 'git log']]);
check('a tool we do not own ends the group', afterWrite.join(' ').includes('Running 1 command'));

resetCommandGroups();
setActiveViewMode('full');

const thinkingLabels = [];
const contextFor = (mode, notices) => ({
	mode,
	ui: {
		notify: (message) => notices.push(message),
		select: async () => undefined,
		setHiddenThinkingLabel: (label) => thinkingLabels.push(label),
	},
});

const printNotices = [];
await registered.handlers[0]('compact', contextFor('print', printNotices));
check('a non-TUI mode gets a notice', printNotices.length === 1);
check('the notice names the settings file', printNotices[0].includes('tool-view.json'));
check('a non-TUI mode writes no settings', !existsSync(settingsFilePath));

await registered.handlers[0]('compact', contextFor('tui', []));
check('compact is written', existsSync(settingsFilePath));
check('the saved view is compact', JSON.parse(readFileSync(settingsFilePath, 'utf-8')).view === 'compact');
check('compact gives a hidden thought its own one line', thinkingLabels.at(-1) === '~ Thought — click to read');

await registered.handlers[0]('full', contextFor('tui', []));
check('full is written', JSON.parse(readFileSync(settingsFilePath, 'utf-8')).view === 'full');
check('full hands the thinking label back to Pi', thinkingLabels.at(-1) === undefined);

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
