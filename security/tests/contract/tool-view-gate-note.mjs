import { Text } from '@earendil-works/pi-tui';
import { clearGateNotes, rememberGateNote, rememberNativeNote } from '#shared/gate-notes.ts';
import { nativeGateNoteRenderers, toolViewRenderers } from '#tool-view/renderers.ts';
import { closeRowGroup, resetRowGroups } from '#tool-view/row-groups.ts';
import { setActiveViewMode } from '#tool-view/session.ts';
import { resetThinking } from '#tool-view/thinking-clock.ts';

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
const BASH_HIDDEN_NOTE = 'Sensitive data protected: bash output was hidden from the AI (potential secrets detected).';
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

const repaintBlock = renderers.renderCall({ code: 'await tools.x()' }, theme, yesContext());
renderers.renderResult(result, options, theme, yesContext());
const repainted = repaintBlock.render(WIDTH).filter((line) => line.trim() === ALLOW_NOTE);

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
clearGateNotes();

const bashRenderers = toolViewRenderers('bash', fallback);
const bashArgs = { command: 'git status' };
const bashState = {};
const bashContext = contextOf(bashState);
const bashAtRow = { toolCallId: 'row-1', args: bashArgs, expanded: false };

rememberGateNote('row-1', BASH_HIDDEN_NOTE);

bashRenderers.renderCall(bashArgs, theme, bashContext(bashAtRow));
const bashBlock = bashRenderers.renderResult(result, options, theme, bashContext(bashAtRow));

const bashText = bashBlock.render(WIDTH).map((line) => line.trim()).filter(Boolean).join(' ');

check('a command row carries its warning', bashText.includes(BASH_HIDDEN_NOTE));
check('the command row still draws the command', bashText.includes('$ git status'));

const readRenderers = toolViewRenderers('read', fallback);
const readArgs = { file_path: 'a.ts' };
const readContext = contextOf({});
const readAtRow = { toolCallId: 'row-2', args: readArgs, expanded: false, durationMs: undefined };

readRenderers.renderCall(readArgs, theme, readContext(readAtRow));
readRenderers.renderResult(result, options, theme, readContext(readAtRow));

const batchLines = bashBlock.render(WIDTH).filter((line) => line.trim());

check('a read joins the command batch and summarizes both', batchLines.length === 3 && batchLines[0].includes('2 actions (1 command, 1 file)'));
check('the settled command sub-group drops its warning and keeps the notice badge', !batchLines.join(' ').includes(BASH_HIDDEN_NOTE) && batchLines[1].includes('[notice]'));

closeRowGroup();
const foldedLines = bashBlock.render(WIDTH).filter((line) => line.trim());

check('closing the mixed batch folds it to one line', foldedLines.length === 1);
check('the folded batch drops its warning', !foldedLines.join(' ').includes(BASH_HIDDEN_NOTE));
check('the folded batch keeps a compact notice badge', foldedLines[0].includes('[notice]'));

resetRowGroups();
clearGateNotes();

setActiveViewMode('full');
rememberNativeNote('native-1', 'Allowed for this conversation: ~/.env');
rememberNativeNote('native-1', 'Rule saved for this project');
const fullReadRenderers = toolViewRenderers('read', fallback);
const fullCall = fullReadRenderers.renderCall({ path: '~/.env' }, theme, contextOf({})({ toolCallId: 'native-1' }));
const fullResult = fullReadRenderers.renderResult(result, options, theme, contextOf({})({ toolCallId: 'native-1' }));
const fullResultLines = fullResult.render(WIDTH).map((line) => line.trim()).filter(Boolean);
check('full mode keeps Pi call header unchanged', fullCall.render(WIDTH).some((line) => line.trim() === 'pi call'));
check(
	'full mode merges native notes into one bottom text line',
	fullResultLines.at(-1) === 'Allowed for this conversation: ~/.env · Rule saved for this project',
);
check('full mode keeps Pi own result above the bottom line', fullResultLines[0] === 'pi result');

const nonRowRenderers = nativeGateNoteRenderers(fallback);
const quietEditResult = nonRowRenderers.renderResult(result, options, theme, contextOf({})({ toolCallId: 'edit-quiet' }));
check('non-row native tool without note returns Pi result directly', quietEditResult.render(WIDTH).join(' ').trim() === 'pi result');
rememberNativeNote('edit-noted', 'Allowed write once');
const notedEditResult = nonRowRenderers.renderResult(result, options, theme, contextOf({})({ toolCallId: 'edit-noted' }));
const notedEditLines = notedEditResult.render(WIDTH).map((line) => line.trim()).filter(Boolean);
check('non-row native tool with note puts text line at the bottom', notedEditLines.at(-1) === 'Allowed write once');

setActiveViewMode('compact');
resetRowGroups();
rememberNativeNote('compact-bash-1', 'Allowed for this conversation: ~/.env');
bashRenderers.renderCall(bashArgs, theme, contextOf({})({ toolCallId: 'compact-bash-1', args: bashArgs, expanded: false }));
const compactBashRow = bashRenderers.renderResult(
	result,
	options,
	theme,
	contextOf({})({ toolCallId: 'compact-bash-1', args: bashArgs, expanded: false }),
);
const compactBashText = compactBashRow.render(WIDTH).join('\n');
check('compact grouped command does not show sub-nested allow note', !compactBashText.includes('Allowed for this conversation'));

resetRowGroups();
clearGateNotes();
resetThinking();
setActiveViewMode('full');

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
