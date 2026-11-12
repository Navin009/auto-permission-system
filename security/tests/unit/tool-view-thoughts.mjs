import { rowGroupLines } from '../../../src/core/tool-view/row-group.ts';
import { wrapText } from '../../../src/core/tool-view/text-wrap.ts';
import { RowKind } from '../../../src/core/tool-view/row-kind.ts';
import { ToolStatus } from '../../../src/core/tool-view/status.ts';
import {
	groupSummary,
	joinRowGroup,
	recordThought,
	resetRowGroups,
	settleRowGroup,
	settleThought,
	toggleThoughtAt,
} from '../../../src/tool-view/row-groups.ts';
import { resetThinking } from '../../../src/tool-view/thinking-clock.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const realNow = Date.now;
let now = 1_000_000;
Date.now = () => now;

const WIDTH = 100;
const HINT = 'ctrl+o to expand';
const lineText = (line) =>
	`${line.indent}${line.mark ? `${line.mark.glyph} ` : ''}${line.text}${line.hint ? ` ${line.hint}` : ''}${line.duration ? ` ${line.duration}` : ''}`;
const row = (overrides) => ({ target: 'npm test', status: ToolStatus.Ok, durationMilliseconds: 1200, ...overrides });
const command = (entry) => ({ type: 'command', row: entry });
const thought = (overrides) => ({ text: 'Let me check the suite first.', elapsedMilliseconds: 4000, isExpanded: false, ...overrides });
const summary = (children, overrides) => ({
	kind: RowKind.Shell,
	children,
	durationMilliseconds: 5000,
	folded: false,
	hint: HINT,
	thinking: undefined,
	isNewestGroup: true,
	...overrides,
});
const group = (children, overrides, width = WIDTH) => rowGroupLines(summary(children, overrides), width);
const body = (lines) => lines.slice(1).map(lineText);
const join = (toolCallId, target, kind = RowKind.Shell) =>
	joinRowGroup({ toolCallId, kind, target, invalidate: () => {} });
const settle = (toolCallId, target, status = ToolStatus.Ok, durationMilliseconds = 1000, kind = RowKind.Shell) =>
	settleRowGroup({ toolCallId, kind, target, status, durationMilliseconds, invalidate: () => {} });

check('wrapText: a short line is one line', wrapText('hello there', 40).length === 1);
check('wrapText: a long line breaks at a word', wrapText('alpha beta gamma', 10).join('|') === 'alpha beta|gamma');
check('wrapText: a word longer than the width is split', wrapText('abcdefghij', 4).join('|') === 'abcd|efgh|ij');
check('wrapText: paragraphs stay apart', wrapText('one\ntwo', 40).join('|') === 'one|two');
check('wrapText: blank lines are dropped', wrapText('one\n\ntwo', 40).join('|') === 'one|two');
check('wrapText: a zero width never loops', wrapText('abc', 0).length > 0);

const liveThought = thought({ elapsedMilliseconds: undefined, text: 'Reading the suite.' });
const liveGroup = group([command(row({})), { type: 'thought', thought: liveThought }]);
check('a live thought draws at the bottom of the row, without an indent', body(liveGroup).at(-1) === 'Thinking...');
check('a live thought is the row its own timer rides on', body(liveGroup).length === 2);
check('a live thought is dim and italic', rowGroupLines(summary([{ type: 'thought', thought: liveThought }]), WIDTH)[1].isDim && rowGroupLines(summary([{ type: 'thought', thought: liveThought }]), WIDTH)[1].isItalic);
check('a live thought is clickable', rowGroupLines(summary([{ type: 'thought', thought: liveThought }]), WIDTH)[1].thoughtIndex === 0);

const settledGroup = group([command(row({})), { type: 'thought', thought: thought({}) }, command(row({ target: 'npm run build' }))]);
check('a settled thought collapses inside the group, in order', body(settledGroup).join('|') === '  └ ✓ $ npm test 1.2s|  └ ~ thinking 4s|  └ ✓ $ npm run build 1.2s');
check('a settled thought keeps its own index', settledGroup[2].thoughtIndex === 0);
check('a settled thought is never counted as a command', settledGroup[0].text === 'Running 2 commands');

const secondThought = group([
	command(row({})),
	{ type: 'thought', thought: thought({ text: 'first' }) },
	{ type: 'thought', thought: thought({ text: 'second' }) },
]);
check('a second thought counts up its own index', secondThought[3].thoughtIndex === 1);

const expandedLive = group([command(row({})), { type: 'thought', thought: thought({ elapsedMilliseconds: undefined, isExpanded: true, text: 'Let me check the suite before touching the build.' }) }], {}, 40);
check('an expanded live thought opens under its line', body(expandedLive).slice(2).every((line) => line.startsWith('  ')));
check('an expanded live thought wraps to the width', expandedLive.length > 3);
check('every expanded line toggles the same thought', expandedLive.slice(2).every((line) => line.thoughtIndex === 0));

const expandedRecord = group([
	{ type: 'thought', thought: thought({ isExpanded: true, text: 'alpha beta gamma delta' }) },
	command(row({})),
], {}, 20);
check('an expanded thought record indents under its line', expandedRecord[2].indent === '    ');
check('an expanded thought record wraps to the width', expandedRecord.slice(1).every((line) => line.text.length <= 16));

const longThought = 'word '.repeat(400).trim();
const cappedThought = group([{ type: 'thought', thought: thought({ isExpanded: true, text: longThought }) }]);
check('an expanded thought stops at twelve lines', cappedThought.length === 1 + 1 + 12);
check('a capped thought ends with a truncation mark', lineText(cappedThought.at(-1)).endsWith('…'));

const folded = group([{ type: 'thought', thought: thought({}) }, command(row({}))], { folded: true });
check('a folded group keeps one line', folded.length === 1);
check('a folded group folds a thought record away', !folded.some((line) => line.thoughtIndex !== undefined));

const foldedLive = group([command(row({})), { type: 'thought', thought: thought({ elapsedMilliseconds: undefined }) }], { folded: true });
check('a folded group still shows the thought at its bottom', body(foldedLive).join('|') === 'Thinking...');

const foldedSettled = group([command(row({})), { type: 'thought', thought: thought({}) }], { folded: true });
check('a folded group keeps the newest thought readable', body(foldedSettled).join('|') === 'Thinking...');

const olderGroup = group([command(row({})), { type: 'thought', thought: thought({}) }], { folded: true, isNewestGroup: false });
check('a group that is no longer newest drops the bottom thought', olderGroup.length === 1);

const readGroup = group([command(row({ target: 'src/a.ts' }))], { kind: RowKind.Read });
check('a read row draws no command line', readGroup.length === 1);

const readThought = group([command(row({ target: 'src/a.ts' })), { type: 'thought', thought: thought({}) }], { kind: RowKind.Read });
check('a read row still shows the thought at its bottom', body(readThought).join('|') === 'Thinking...');

const readRecord = group([
	command(row({ target: 'src/a.ts' })),
	{ type: 'thought', thought: thought({}) },
	command(row({ target: 'src/b.ts' })),
], { kind: RowKind.Read });
check('a read row records a thought once a call follows', body(readRecord).join('|') === '  └ ~ thinking 4s');

const manyCommands = Array.from({ length: 11 }, (_, index) => command(row({ target: `cmd-${index}` })));
const windowWithThought = group([...manyCommands, { type: 'thought', thought: thought({}) }]);
check('a thought after the window keeps its absolute index', windowWithThought.at(-1).thoughtIndex === 0);
check('a thought never hides the overflow line', body(windowWithThought)[0] === '  └ ... (3 earlier calls)');

resetRowGroups();
resetThinking();

const running = join('call-a', 'npm test');
recordThought('A first thought.');
const streamed = groupSummary(running, HINT);
check('a live thought joins the running group', rowGroupLines(streamed, WIDTH).at(-1).text === 'Thinking...');
check('a live thought reads the text that streams', streamed.children.at(-1).thought.text === 'A first thought.');

now += 100;
recordThought('A first thought, continued.');
const continued = groupSummary(running, HINT);
check('a thought keeps streaming into the same line', continued.children.filter((child) => child.type === 'thought').length === 1);
check('a streamed thought updates its text', continued.children.at(-1).thought.text === 'A first thought, continued.');

now += 3_900;
settleThought();
settle('call-a', 'npm test', ToolStatus.Ok, 4_000);
const settledBottom = groupSummary(running, HINT);
check('a settled thought waits at the bottom of its group', rowGroupLines(settledBottom, WIDTH).at(-1).text === 'Thinking...');

join('call-b', 'npm run build');
const withNextCall = groupSummary(running, HINT);
check('a settled thought collapses into the group on the next call', rowGroupLines(withNextCall, WIDTH)[2].text === '~ thinking 4s');
check('a collapsed thought carries its own time', withNextCall.children
	.filter((child) => child.type === 'thought')
	.every((child) => child.thought.elapsedMilliseconds === 4_000));

toggleThoughtAt(running, 0);
const toggled = groupSummary(running, HINT);
check('clicking a thought opens it', toggled.children.filter((child) => child.type === 'thought')[0].thought.isExpanded === true);
toggleThoughtAt(running, 0);
check('clicking it again closes it', groupSummary(running, HINT).children.filter((child) => child.type === 'thought')[0].thought.isExpanded === false);

resetRowGroups();
recordThought('A thought before any call.');
const afterPending = join('call-b', 'git status');
const adopted = groupSummary(afterPending, HINT);
check('a thought that starts before a row is adopted by it', adopted.children[0].type === 'thought');
check('an adopted thought keeps its text', adopted.children[0].thought.text === 'A thought before any call.');

Date.now = realNow;
resetRowGroups();
resetThinking();

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
