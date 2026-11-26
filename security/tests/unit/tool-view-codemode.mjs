import { rowTarget } from '#core/tool-view/arguments.ts';
import { rowGroupLines } from '#core/tool-view/row-group.ts';
import { RowKind, rowKindOf, rowLabelOf } from '#core/tool-view/row-kind.ts';
import { ToolStatus } from '#core/tool-view/status.ts';
import { codemodeSubLines } from '#tool-view/codemode-lines.ts';
import {
	rememberNestedEnd,
	rememberNestedStart,
	resetNestedCalls,
} from '#tool-view/nested-calls.ts';
import {
	closeRowGroup,
	groupSummary,
	joinRowGroup,
	resetRowGroups,
	settleRowGroup,
} from '#tool-view/row-groups.ts';
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
};

const realNow = Date.now;
let now = 1_000_000;
Date.now = () => now;

const WIDTH = 100;
const HINT = 'ctrl+o to expand';
const lineText = (line) =>
	`${line.indent}${line.mark ? `${line.mark.glyph} ` : ''}${line.text}${line.hint ? ` ${line.hint}` : ''}${line.duration ? ` ${line.duration}` : ''}`;
const linesOf = (group) => rowGroupLines(groupSummary(group, HINT), WIDTH);

check('codemode is a row kind', rowKindOf('codemode') === RowKind.Codemode);
check('its header carries no count', rowLabelOf(RowKind.Codemode).fixedTitle === 'codemode');
check('a shell row still counts commands', rowLabelOf(RowKind.Shell).fixedTitle === undefined);

resetNestedCalls();
resetRowGroups();
resetThinking();

rememberNestedStart('call-code', 'call-code/1', 'mcp:dev-radius:search', { query: 'rank' });
rememberNestedStart('call-code', 'call-code/2', 'read', { path: 'src/config.ts' });
now += 120;
rememberNestedEnd('call-code', 'call-code/1', false);
now += 8;
rememberNestedEnd('call-code', 'call-code/2', false);

const subLines = codemodeSubLines('call-code', { code: 'await tools.searchTools("rank")\nconst x = 1' });
const target = rowTarget('codemode', { code: 'await tools.searchTools("rank")\nconst x = 1' });
check('the script line comes first', subLines[0].text === 'await tools.searchTools("rank")');
check('the script line is the row target', subLines[0].text === target);
check('the script line has no mark of its own', subLines[0].status === undefined);
check('the nested calls follow', subLines.length === 3);
check('a nested call names its tool and first argument', subLines[1].text === 'mcp:dev-radius:search rank');
check('a finished nested call keeps its status', subLines[1].status === ToolStatus.Ok);
check('a nested call carries no timer of its own', !('durationMilliseconds' in subLines[1]));

const group = joinRowGroup({
	toolCallId: 'call-code',
	kind: RowKind.Codemode,
	target,
	invalidate: () => {},
	subLines,
});

const running = linesOf(group);
check('the header reads codemode and its timer', lineText(running[0]) === '⠋ ▾ codemode · 0ms');
check('the row summarizes exact inner tool names and call count', lineText(running[1]) === '  └ mcp:dev-radius:search, read (2 calls)');
check('each nested call nests under the parent row while running', lineText(running[2]) === '    ├ ✓ mcp:dev-radius:search rank');
check('the final nested call closes the inner branch', lineText(running[3]) === '    └ ✓ read src/config.ts');
check('codemode never counts commands in the header', !running[0].text.includes('Running'));
check('tool summary uses text and muted spans', running[1].spans?.[0]?.tone === 'text' && running[1].spans?.[1]?.tone === 'muted');
check('nested call uses title and muted spans', running[2].spans?.[0]?.tone === 'title' && running[2].spans?.[1]?.tone === 'muted');

now += 1_000;
settleRowGroup({
	toolCallId: 'call-code',
	kind: RowKind.Codemode,
	target,
	status: ToolStatus.Ok,
	durationMilliseconds: 1_200,
	invalidate: () => {},
	subLines,
});

const settled = linesOf(group);
check('a settled codemode row keeps its title', lineText(settled[0]) === '✓ ▾ codemode · 1.2s');
check('a completed codemode row hides internal tool calls and keeps tool summary', settled.length === 2 && lineText(settled[1]) === '  └ mcp:dev-radius:search, read (2 calls)');

closeRowGroup();

const folded = linesOf(group);
check('a folded codemode row summarizes scripts and total inner calls', lineText(folded[0]) === '✓ ▸ codemode (1 script · 2 calls) ctrl+o to expand · 1.2s');
check('a folded codemode row hides its child lines', folded.length === 1);

resetNestedCalls();
check('a reset forgets the nested calls', codemodeSubLines('call-code', undefined).length === 0);

resetRowGroups();
const scriptOnlyGroup = joinRowGroup({
	toolCallId: 'call-script-only',
	kind: RowKind.Codemode,
	target: 'return 1 + 1',
	invalidate: () => {},
	subLines: [{ text: 'return 1 + 1', status: undefined, kind: 'script' }],
});
const scriptOnlyLines = linesOf(scriptOnlyGroup);
check('codemode without inner calls falls back to dim italic script line', scriptOnlyLines[1].spans?.[0]?.tone === 'dim' && scriptOnlyLines[1].spans?.[0]?.italic === true);

resetRowGroups();
const twelveCalls = [...Array(12).keys()].map((index) => ({
	text: `read src/file-${index}.ts`,
	status: ToolStatus.Ok,
	kind: 'call',
}));
const twelveGroup = joinRowGroup({
	toolCallId: 'call-twelve',
	kind: RowKind.Codemode,
	target: 'await run()',
	invalidate: () => {},
	subLines: [{ text: 'await run()', status: undefined, kind: 'script' }, ...twelveCalls],
});
const twelveLines = linesOf(twelveGroup);
check('codemode shows all 12 inner calls without overflow', twelveLines.length === 14 && lineText(twelveLines[2]) === '    ├ ✓ read src/file-0.ts');

resetNestedCalls();
resetRowGroups();
const liveGroup = joinRowGroup({
	toolCallId: 'call-live',
	kind: RowKind.Codemode,
	target: 'await runBatch()',
	invalidate: () => {},
	subLines: codemodeSubLines('call-live', { code: 'await runBatch()' }),
});
for (let index = 0; index < 30; index += 1) {
	rememberNestedStart('call-live', `call-live/${index}`, 'mcp__facebook_ads__ads_get_ad_entities', { id: String(index) });
	rememberNestedEnd('call-live', `call-live/${index}`, false);
}
const liveCapped = linesOf(liveGroup);
check('live codemode with 30 inner calls keeps the newest 12 calls plus header, parent, and overflow', liveCapped.length === 15);
check('live codemode reports 18 hidden earlier inner calls', lineText(liveCapped[2]) === '    ├ ... (18 earlier inner calls)');
check('live codemode keeps exact mcp tool names without stripping', lineText(liveCapped[1]) === '  └ mcp__facebook_ads__ads_get_ad_entities (30 calls)');

settleRowGroup({
	toolCallId: 'call-live',
	kind: RowKind.Codemode,
	target: 'await runBatch()',
	status: ToolStatus.Ok,
	durationMilliseconds: 900,
	invalidate: () => {},
});
const secondCodeGroup = joinRowGroup({
	toolCallId: 'call-live-2',
	kind: RowKind.Codemode,
	target: 'await secondRun()',
	invalidate: () => {},
	subLines: [
		{ text: 'await secondRun()', status: undefined, kind: 'script' },
		{ text: 'read src/next.ts', status: ToolStatus.Running, kind: 'call' },
	],
});
check('a consecutive codemode call joins the same codemode group', secondCodeGroup === liveGroup);
const multiCodeLines = linesOf(liveGroup);
check('earlier settled codemode calls collapse to tool summary line', lineText(multiCodeLines[1]) === '  ├ ✓ mcp__facebook_ads__ads_get_ad_entities (30 calls)');
check('the active codemode call renders as the next sequence row', lineText(multiCodeLines[2]) === '  └ ⠋ read (1 call)');
check('the active codemode call nests its inner calls underneath', lineText(multiCodeLines[3]) === '      └ ⠋ read src/next.ts');

settleRowGroup({
	toolCallId: 'call-live-2',
	kind: RowKind.Codemode,
	target: 'await secondRun()',
	status: ToolStatus.Ok,
	durationMilliseconds: 400,
	invalidate: () => {},
	subLines: [
		{ text: 'await secondRun()', status: undefined, kind: 'script' },
		{ text: 'read src/next.ts', status: ToolStatus.Ok, kind: 'call' },
	],
});
const settledMultiCode = linesOf(liveGroup);
check('when all codemode calls settle, all internal tool calls are hidden', settledMultiCode.length === 3);

resetNestedCalls();
resetRowGroups();
let multiScriptGroup;
for (let scriptIndex = 0; scriptIndex < 5; scriptIndex += 1) {
	multiScriptGroup = joinRowGroup({
		toolCallId: `script-${scriptIndex}`,
		kind: RowKind.Codemode,
		target: `await step${scriptIndex}()`,
		invalidate: () => {},
		subLines: Array.from({ length: 4 }, (_, callIndex) => ({
			text: `mcp__facebook_ads__ads_get_ad_entities ${callIndex}`,
			status: ToolStatus.Ok,
			kind: 'call',
			toolName: 'mcp__facebook_ads__ads_get_ad_entities',
			detail: String(callIndex),
		})),
	});
	settleRowGroup({
		toolCallId: `script-${scriptIndex}`,
		kind: RowKind.Codemode,
		target: `await step${scriptIndex}()`,
		status: ToolStatus.Ok,
		durationMilliseconds: 500,
		invalidate: () => {},
		subLines: Array.from({ length: 4 }, (_, callIndex) => ({
			text: `mcp__facebook_ads__ads_get_ad_entities ${callIndex}`,
			status: ToolStatus.Ok,
			kind: 'call',
			toolName: 'mcp__facebook_ads__ads_get_ad_entities',
			detail: String(callIndex),
		})),
	});
}
closeRowGroup();
const foldedFiveScripts = linesOf(multiScriptGroup);
check('folded 5-script 20-call codemode group matches summary format', lineText(foldedFiveScripts[0]) === '✓ ▸ codemode (5 scripts · 20 calls) ctrl+o to expand · 500ms');

resetNestedCalls();
resetRowGroups();
let fifteenGroup;
for (let scriptIndex = 0; scriptIndex < 15; scriptIndex += 1) {
	fifteenGroup = joinRowGroup({
		toolCallId: `many-script-${scriptIndex}`,
		kind: RowKind.Codemode,
		target: `await s${scriptIndex}()`,
		invalidate: () => {},
	});
	settleRowGroup({
		toolCallId: `many-script-${scriptIndex}`,
		kind: RowKind.Codemode,
		target: `await s${scriptIndex}()`,
		status: ToolStatus.Ok,
		durationMilliseconds: 100,
		invalidate: () => {},
	});
}
const fifteenLines = linesOf(fifteenGroup);
check('codemode group caps at newest 12 script rows plus header and overflow', fifteenLines.length === 14 && lineText(fifteenLines[1]) === '  ├ ... (3 earlier calls)');

const afterShellGroup = joinRowGroup({
	toolCallId: 'call-after-code',
	kind: RowKind.Shell,
	target: 'npm test',
	invalidate: () => {},
});
check('a shell call after codemode starts a separate group', afterShellGroup !== liveGroup);

resetRowGroups();
resetThinking();
Date.now = realNow;

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
