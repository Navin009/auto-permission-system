import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Text } from '@earendil-works/pi-tui';
import { setActiveViewMode } from '../../../src/tool-view/session.ts';
import { closeRowGroup, resetRowGroups } from '../../../src/tool-view/row-groups.ts';
import { resetThinking, thinkingState } from '../../../src/tool-view/thinking-clock.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const scratchAgentDir = mkdtempSync(join(tmpdir(), 'tool-view-agent-'));
process.env.PI_CODING_AGENT_DIR = scratchAgentDir;

const settingsFilePath = join(scratchAgentDir, 'tool-view.json');
const extension = await import('../../../extensions/tool-view.ts');

const registered = { resolvers: [], commands: [], handlers: [], events: [], eventHandlers: new Map(), transformers: [] };
const pi = {
	on: (event, handler) => { registered.events.push(event); registered.eventHandlers.set(event, handler); return () => {}; },
	registerToolRenderer: (resolver) => { registered.resolvers.push(resolver); },
	registerCommand: (name, options) => { registered.commands.push(name); registered.handlers.push(options.handler); },
	registerMarkdownTransformer: (transformer) => { registered.transformers.push(transformer); },
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
check('a streaming message feeds the thinking row', registered.events.includes('message_update'));

const resolver = registered.resolvers[0];
const handsBackToPi = (toolName) => resolver(toolName, () => 'pi-renderers') === 'pi-renderers';
check('owns bash', !handsBackToPi('bash'));
check('owns read', !handsBackToPi('read'));
check('leaves edit to Pi', handsBackToPi('edit'));
check('leaves codemode to Pi', handsBackToPi('codemode'));
check('hands write back to Pi', handsBackToPi('write'));
check('hands an MCP tool back to Pi', handsBackToPi('mcp__docs__search'));
check('hands an unknown tool back to Pi', handsBackToPi('some-future-tool'));

const theme = { fg: (color, text) => text };
const fallbackRenderers = { renderShell: 'default', renderCall: () => new Text('pi-renderer'), renderResult: () => new Text('pi-renderer') };
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
const renderRead = (toolCallId, path) =>
	resolver('read', () => fallbackRenderers)
		.renderCall({ path }, theme, renderContext({ toolCallId, args: { path } }))
		.render(100);
const settleCommand = (toolCallId, command) =>
	resolver('bash', () => fallbackRenderers).renderResult(
		{ content: [{ type: 'text', text: 'ok' }] },
		{ expanded: false, isPartial: false },
		theme,
		renderContext({ toolCallId, args: { command }, durationMs: 120 }),
	);

resetRowGroups();
setActiveViewMode('compact');
check('compact owns the shell', resolver('bash', () => fallbackRenderers).renderShell === 'self');
const [firstGroup, secondGroup] = renderCommands([['call-a', 'ls'], ['call-b', 'pwd']]);
check('a shell call opens a one-command row', firstGroup.join(' ').includes('Running 1 command'));
check('a second command joins it silently', secondGroup.length === 0);
const [firstGroupAgain] = renderCommands([['call-a', 'ls']]);
check('the first command keeps drawing the row', firstGroupAgain.join(' ').includes('Running 2 commands'));

const endTurn = (content) => registered.eventHandlers.get('turn_end')({ message: { role: 'assistant', content } });
endTurn([{ type: 'toolCall', id: 'call-b', name: 'bash' }]);
renderCommands([['call-turn', 'git diff']]);
const [afterToolOnlyTurn] = renderCommands([['call-a', 'ls']]);
check('a tool-only turn keeps the group open', afterToolOnlyTurn.join(' ').includes('Running 3 commands'));

endTurn([{ type: 'text', text: 'Here is what I found.' }]);
const [afterProseTurn] = renderCommands([['call-prose', 'git status']]);
check('an assistant reply with text closes the group', afterProseTurn.join(' ').includes('Running 1 command'));

const readRow = renderRead('call-read', 'src/a.ts');
check('a read opens its own row', readRow.join(' ').includes('Reading 1 file'));
const [afterRead] = renderCommands([['call-c', 'git status']]);
check('a read ends the shell group', afterRead.join(' ').includes('Running 1 command'));

resolver('write', () => fallbackRenderers);
const [afterWrite] = renderCommands([['call-d', 'git log']]);
check('a tool we do not own ends the group', afterWrite.join(' ').includes('Running 1 command'));

resetRowGroups();
resetThinking();
const [beforeText] = renderCommands([['call-text-a', 'ls']]);
registered.eventHandlers.get('message_update')({ message: { role: 'assistant', content: [{ type: 'text', text: 'Here is what I found.' }] } });
const [afterStreamingText] = renderCommands([['call-text-b', 'git status']]);
check('streaming text closes the group before the turn ends', beforeText.join(' ').includes('Running 1 command'));
check('the command after streaming text opens its own group', afterStreamingText.join(' ').includes('Running 1 command'));

resetRowGroups();
resetThinking();
renderCommands([['call-thought-a', 'ls']]);
settleCommand('call-thought-a', 'ls');
registered.eventHandlers.get('message_update')({ message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }] } });
endTurn([{ type: 'toolCall', id: 'call-thought-a', name: 'bash' }]);
const [afterThought] = renderCommands([['call-thought-b', 'pwd']]);
check('a command after a thought opens its own row', afterThought.join(' ').includes('Running 1 command'));
const [thoughtDrawer] = renderCommands([['call-thought-a', 'ls']]);
check('the row above the thought keeps one command', !thoughtDrawer.join(' ').includes('Running 2 commands'));

resetRowGroups();
resetThinking();

resetRowGroups();
setActiveViewMode('full');
check('full hands the shell back to Pi', resolver('bash', () => fallbackRenderers).renderShell === undefined);

resetThinking();
check('no thought before one streams', thinkingState() === undefined);
registered.eventHandlers.get('message_update')({ message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }] } });
check('a thinking update starts the row bracket', thinkingState() !== undefined);
registered.eventHandlers.get('message_update')({ message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'hi' }] } });
check('a text update ends the row bracket', thinkingState() === undefined);
registered.eventHandlers.get('message_update')({ message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }] } });
endTurn([{ type: 'text', text: 'done' }]);
check('a turn boundary ends the row bracket', thinkingState() === undefined);

const thinkingLabels = [];
const contextFor = (mode, notices) => ({
	mode,
	ui: {
		notify: (message) => notices.push(message),
		select: async () => undefined,
		setHiddenThinkingLabel: (label) => thinkingLabels.push(label),
	},
});

registered.eventHandlers.get('session_start')({}, contextFor('tui', []));
check('a session start never relabels Pi own thinking', thinkingLabels.length === 0);

registered.eventHandlers.get('session_start')({}, contextFor('tui', []));
check('a second session start never relabels it either', thinkingLabels.length === 0);

const printNotices = [];
await registered.handlers[0]('compact', contextFor('print', printNotices));
check('a non-TUI mode gets a notice', printNotices.length === 1);
check('the notice names the settings file', printNotices[0].includes('tool-view.json'));
check('a non-TUI mode writes no settings', !existsSync(settingsFilePath));

await registered.handlers[0]('compact', contextFor('tui', []));
check('compact is written', existsSync(settingsFilePath));
check('the saved view is compact', JSON.parse(readFileSync(settingsFilePath, 'utf-8')).view === 'compact');
check('switching to compact leaves Pi own thinking label alone', thinkingLabels.length === 0);

resolver('bash', () => fallbackRenderers)
	.renderCall({ command: 'npm test' }, theme, renderContext({ toolCallId: 'call-label' }))
	.render(100);
check('a live row writes no thinking label', thinkingLabels.length === 0);

closeRowGroup();
check('a closed row writes no thinking label', thinkingLabels.length === 0);

resetRowGroups();
check('a reset writes no thinking label', thinkingLabels.length === 0);

await registered.handlers[0]('full', contextFor('tui', []));
check('full is written', JSON.parse(readFileSync(settingsFilePath, 'utf-8')).view === 'full');
check('switching to full leaves Pi own thinking label alone', thinkingLabels.length === 0);

const usageNotices = [];
await registered.handlers[0]('rows', contextFor('tui', usageNotices));
check('an unknown argument explains the usage', usageNotices.length === 1 && usageNotices[0].includes('/tool-view compact'));
check('an unknown argument keeps the saved view', JSON.parse(readFileSync(settingsFilePath, 'utf-8')).view === 'full');

const menuNotices = [];
await registered.handlers[0]('', contextFor('tui', menuNotices));
check('a cancelled menu changes nothing', menuNotices.length === 0);

const menus = [];
const menuContext = (notices, pick) => ({
	mode: 'tui',
	ui: {
		notify: (message) => notices.push(message),
		select: async (title, options) => {
			menus.push({ title, options });
			return pick(options);
		},
		setHiddenThinkingLabel: () => {},
	},
});
const compactNotices = [];
await registered.handlers[0]('', menuContext(compactNotices, (options) => options.find((option) => option.includes('Compact'))));
const [menu] = menus;
check('the menu is titled like the permission-mode picker', menu.title === 'Select tool view:');
check('the menu lists both views', menu.options.length === 2);
check('each option carries an icon and a description', menu.options.every((option) => option.includes(' —  ')));
check('the saved view is the one marked active', menu.options.filter((option) => option.includes('(active)')).length === 1);
check('picking compact saves it', JSON.parse(readFileSync(settingsFilePath, 'utf-8')).view === 'compact');
check('picking compact says it is on', compactNotices[0]?.includes('Compact on'));

const repeatNotices = [];
await registered.handlers[0]('', menuContext(repeatNotices, (options) => options.find((option) => option.includes('Compact'))));
check('picking the active view again says it is already on', repeatNotices[0]?.includes('already Compact'));

rmSync(scratchAgentDir, { recursive: true, force: true });

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
