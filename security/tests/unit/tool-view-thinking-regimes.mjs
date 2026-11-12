import { RowKind } from '../../../src/core/tool-view/row-kind.ts';
import { ToolStatus } from '../../../src/core/tool-view/status.ts';
import {
	drawsFrame,
	groupSummary,
	joinRowGroup,
	resetRowGroups,
	settleRowGroup,
} from '../../../src/tool-view/row-groups.ts';
import { beginThinking, endThinking, resetThinking } from '../../../src/tool-view/thinking-clock.ts';
import {
	noteThinkingRendered,
	resetThinkingVisibility,
} from '../../../src/tool-view/thinking-visibility.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const realNow = Date.now;
let now = 1_000_000;
Date.now = () => now;

const HINT = 'ctrl+o to expand';
const join = (toolCallId, target, kind = RowKind.Shell) =>
	joinRowGroup({ toolCallId, kind, target, invalidate: () => {} });
const settle = (toolCallId, target, status = ToolStatus.Ok, durationMilliseconds = 1_000, kind = RowKind.Shell) =>
	settleRowGroup({ toolCallId, kind, target, status, durationMilliseconds, invalidate: () => {} });
const thoughtBetween = (seconds) => {
	beginThinking();
	now += seconds * 1_000;
	endThinking();
};

resetRowGroups();
resetThinking();
resetThinkingVisibility();

const hiddenFirst = join('hidden-a', 'npm test');
settle('hidden-a', 'npm test', ToolStatus.Ok, 1_000);
thoughtBetween(3);
const hiddenSecond = join('hidden-b', 'npm run build');
check('a hidden thought keeps one row', hiddenSecond === hiddenFirst);
check('a hidden thought leaves the row on its first command', drawsFrame(hiddenFirst, 'hidden-a'));
check('a hidden thought is still counted only as commands', groupSummary(hiddenFirst, HINT).rows.length === 2);

resetRowGroups();
resetThinking();
resetThinkingVisibility();
noteThinkingRendered();

const visibleFirst = join('visible-a', 'npm test');
settle('visible-a', 'npm test', ToolStatus.Ok, 1_000);
thoughtBetween(3);
const visibleSecond = join('visible-b', 'npm run build');
check('a rendered thought starts a new row', visibleSecond !== visibleFirst);
check('the row above a rendered thought folds', groupSummary(visibleFirst, HINT).folded);
check('the new row starts on its own command', drawsFrame(visibleSecond, 'visible-b'));
check('the new row is not counted with the old one', groupSummary(visibleSecond, HINT).rows.length === 1);

resetRowGroups();
resetThinking();
resetThinkingVisibility();
noteThinkingRendered();

const runningFirst = join('running-a', 'npm test');
thoughtBetween(2);
const runningSecond = join('running-b', 'npm run build');
check('a rendered thought never folds away a running command', runningSecond === runningFirst);
check('the running row still holds both commands', groupSummary(runningFirst, HINT).rows.length === 2);

Date.now = realNow;
resetThinking();
resetThinkingVisibility();
resetRowGroups();

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
