import { rowGroupLines } from '../../../src/core/tool-view/row-group.ts';
import { RowKind, rowKindOf, rowLabelOf } from '../../../src/core/tool-view/row-kind.ts';
import { ToolStatus } from '../../../src/core/tool-view/status.ts';
import { codemodeSubLines } from '../../../src/tool-view/codemode-lines.ts';
import {
	rememberNestedEnd,
	rememberNestedStart,
	resetNestedCalls,
} from '../../../src/tool-view/nested-calls.ts';
import { groupSummary, joinRowGroup, resetRowGroups, settleRowGroup } from '../../../src/tool-view/row-groups.ts';
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
check('the script line comes first', subLines[0].text === 'await tools.searchTools("rank")');
check('the script line has no mark of its own', subLines[0].status === undefined);
check('the nested calls follow', subLines.length === 3);
check('a nested call names its tool and first argument', subLines[1].text === 'mcp:dev-radius:search rank');
check('a finished nested call keeps its status', subLines[1].status === ToolStatus.Ok);
check('a nested call carries no timer of its own', !('durationMilliseconds' in subLines[1]));

const group = joinRowGroup({
	toolCallId: 'call-code',
	kind: RowKind.Codemode,
	target: 'codemode',
	invalidate: () => {},
	subLines,
});

const running = linesOf(group);
check('the header reads codemode and its timer', lineText(running[0]) === '● codemode · 0ms');
check('the row draws the script under the code row', lineText(running[1]) === '  └ await tools.searchTools("rank")');
check('each nested call keeps its own line', lineText(running[2]) === '  └ ✓ mcp:dev-radius:search rank');
check('a nested call line carries no time', lineText(running[3]) === '  └ ✓ read src/config.ts');
check('codemode never counts commands in the header', !running[0].text.includes('Running'));

now += 1_000;
settleRowGroup({
	toolCallId: 'call-code',
	kind: RowKind.Codemode,
	target: 'codemode',
	status: ToolStatus.Ok,
	durationMilliseconds: 1_200,
	invalidate: () => {},
	subLines,
});

const settled = linesOf(group);
check('a settled codemode row keeps its title', lineText(settled[0]) === '✓ codemode · 1.2s');
check('the sub-lines survive the settle', settled.length === 4);

resetNestedCalls();
check('a reset forgets the nested calls', codemodeSubLines('call-code', undefined).length === 0);

resetRowGroups();
resetThinking();
Date.now = realNow;

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
