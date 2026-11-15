import { Text } from '@earendil-works/pi-tui';
import { clearGateNotes, rememberGateNote } from '../../../src/shared/gate-notes.ts';
import { toolViewRenderers } from '../../../src/tool-view/renderers.ts';
import { resetRowGroups } from '../../../src/tool-view/row-groups.ts';
import { setActiveViewMode } from '../../../src/tool-view/session.ts';
import { resetThinking } from '../../../src/tool-view/thinking-clock.ts';

let pass = 0;
let fail = 0;

const check = (name, condition) => {
	if (condition) {
		pass++;
		return;
	}

	fail++;
	console.log('FAIL:', name, '→', JSON.stringify(condition));
}

const WIDTH = 80;
const theme = { fg: (_color, text) => text, bg: (_color, text) => text };
const fallback = {
	renderShell: 'default',
	renderCall: () => new Text('pi call'),
	renderResult: () => new Text('pi result'),
};
const renderers = toolViewRenderers('codemode', fallback);
const ALLOW_NOTE = 'Output permitted: allowed codemode output for this call.';
const HIDDEN_NOTE = 'Sensitive data protected: codemode output was hidden from the AI (potential secrets detected).';
const result = { content: [{ type: 'text', text: 'ok' }] };
const options = { expanded: true, isPartial: false };

const contextOf = (state) => (overrides) => ({
	args: {},
	toolCallId: 'call-1',
	invalidate: () => {},
	lastComponent: undefined,
	state,
	cwd: '/work/project',
	executionStarted: true,
	argsComplete: true,
	isPartial: false,
	expanded: true,
	showImages: false,
	isError: false,
	durationMs: 120,
	outputPad: 1,
	keyText: () => 'ctrl+o',
	keyHint: () => 'ctrl+o to expand',
	...overrides,
});

setActiveViewMode('compact');
resetRowGroups();
resetThinking();
clearGateNotes();

const yesState = {};
const yesContext = contextOf(yesState);
rememberGateNote('call-1', ALLOW_NOTE);

const yesBlock = renderers.renderCall({ code: 'await tools.x()' }, theme, yesContext());
renderers.renderResult(result, options, theme, yesContext());
const yesLines = yesBlock.render(WIDTH);
const yesShown = yesLines.map((line) => line.trim()).filter(Boolean);

check('an allowed call shows its warning in Pi view', yesLines.some((line) => line.trim() === ALLOW_NOTE));
check('the warning sits under Pi own result', yesShown.at(-1) === ALLOW_NOTE);
check('Pi own block is still drawn', yesLines.some((line) => line.includes('pi result')));

renderers.renderResult(result, options, theme, yesContext());
const repainted = yesBlock.render(WIDTH).filter((line) => line.trim() === ALLOW_NOTE);

check('a repaint keeps one warning line', repainted.length === 1);

const noState = {};
const noContext = contextOf(noState);
rememberGateNote('call-2', HIDDEN_NOTE);

const noBlock = renderers.renderCall({ code: 'await tools.y()' }, theme, noContext({ toolCallId: 'call-2' }));
renderers.renderResult(result, options, theme, noContext({ toolCallId: 'call-2' }));
const noLines = noBlock.render(WIDTH);
const noText = noLines.map((line) => line.trim()).filter(Boolean).join(' ');

check('a withheld call shows its warning in Pi view', noText.includes(HIDDEN_NOTE));
check('a withheld call says nothing about allowing', !noText.includes(ALLOW_NOTE));

const quietState = {};
const quietContext = contextOf(quietState);
const quietBlock = renderers.renderCall({ code: 'await tools.z()' }, theme, quietContext({ toolCallId: 'call-quiet' }));
renderers.renderResult(result, options, theme, quietContext({ toolCallId: 'call-quiet' }));

check('a call that never hit the gate draws no warning', !quietBlock.render(WIDTH).some((line) => line.trim() === ALLOW_NOTE));

clearGateNotes();
const clearedState = {};
const clearedContext = contextOf(clearedState);
const clearedBlock = renderers.renderCall({ code: 'await tools.x()' }, theme, clearedContext());
renderers.renderResult(result, options, theme, clearedContext());

check('a new conversation draws no old warning', !clearedBlock.render(WIDTH).some((line) => line.trim() === ALLOW_NOTE));

resetRowGroups();
resetThinking();

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
