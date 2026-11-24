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
check('the row draws the script under the code row', lineText(running[1]) === '  ├ await tools.searchTools("rank")');
check('each nested call keeps its own line', lineText(running[2]) === '  ├ ✓ mcp:dev-radius:search rank');
check('a nested call line carries no time', lineText(running[3]) === '  └ ✓ read src/config.ts');
check('codemode never counts commands in the header', !running[0].text.includes('Running'));
check('script preview uses dim italic span', running[1].spans?.[0]?.tone === 'dim' && running[1].spans?.[0]?.italic === true);
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
check('the sub-lines survive the settle', settled.length === 4);

closeRowGroup();

const folded = linesOf(group);
check('a folded codemode row names the script', lineText(folded[0]) === `✓ ▸ codemode (${target}) ctrl+o to expand · 1.2s`);
check('a folded codemode row hides its child lines', folded.length === 1);

resetNestedCalls();
check('a reset forgets the nested calls', codemodeSubLines('call-code', undefined).length === 0);

resetRowGroups();
const manyCalls = [...Array(12).keys()].map((index) => ({
	text: `read src/file-${index}.ts`,
	status: ToolStatus.Ok,
	kind: 'call',
}));
const cappedGroup = joinRowGroup({
	toolCallId: 'call-many',
	kind: RowKind.Codemode,
	target: 'await run()',
	invalidate: () => {},
	subLines: [{ text: 'await run()', status: undefined, kind: 'script' }, ...manyCalls],
});
const cappedLines = linesOf(cappedGroup);
check('codemode caps visible inner calls and adds an overflow line', cappedLines.length === 10);
check('codemode overflow reports hidden inner calls', lineText(cappedLines[2]) === '  ├ ... (5 earlier inner calls)');

resetRowGroups();
resetThinking();
Date.now = realNow;

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
