import { ViewMode } from '../../../src/core/tool-view/view-mode.ts';
import {
	applyThinkingVisibility,
	resetThinkingVisibility,
} from '../../../src/tool-view/thinking-visibility.ts';

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

const labels = [];
const ui = { setHiddenThinkingLabel: (label) => labels.push(label) };
const failingUi = {
	setHiddenThinkingLabel: () => {
		throw new Error('ui not ready');
	},
};

resetThinkingVisibility();
applyThinkingVisibility(ViewMode.Compact, ui);
check('compact hides Pi hidden thinking with an empty label', labels.join('|') === '');

applyThinkingVisibility(ViewMode.Compact, ui);
check('repeating compact does not write again', labels.length === 1);

applyThinkingVisibility(ViewMode.Full, ui);
check('full restores Pi hidden thinking label', labels.length === 2 && labels[1] === undefined);

applyThinkingVisibility(ViewMode.Full, ui);
check('repeating full does not write again', labels.length === 2);

applyThinkingVisibility(ViewMode.Compact, ui);
check('switching back hides it again', labels.length === 3 && labels[2] === '');

resetThinkingVisibility();
applyThinkingVisibility(ViewMode.Compact, ui);
check('a reset makes the next apply write again', labels.length === 4 && labels[3] === '');

const beforeMissingUi = labels.length;
applyThinkingVisibility(ViewMode.Compact, undefined);
check('a missing ui context is not an error', labels.length === beforeMissingUi);

resetThinkingVisibility();
applyThinkingVisibility(ViewMode.Compact, failingUi);
applyThinkingVisibility(ViewMode.Compact, ui);
check('a failed apply leaves the next one to retry', labels.length === beforeMissingUi + 1 && labels.at(-1) === '');

resetThinkingVisibility();
console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
