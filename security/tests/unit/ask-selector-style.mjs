import { AskSelector } from '../../../src/ui/ask-selector.ts';

let pass = 0;
let fail = 0;

const check = (name, cond) => {
	if (cond) {
		pass++;
		return;
	}

	fail++;
	console.log('FAIL:', name);
};

const painted = [];
const theme = {
	fg: (color, text) => {
		painted.push({ color, text });
		return text;
	},
	bold: (text) => text,
};

const selector = new AskSelector({
	title: [
		'Let cat read ~/.aws/credentials?',
		'File     ~/.aws/credentials',
		'Folder   ~/.aws/',
		'Why      contains AWS credentials',
		'Finding  42: KEY=example',
	].join('\n'),
	footer: 'Default: No',
	options: ['No', 'Yes'],
	timeoutMs: 15_000,
	tui: { requestRender: () => {}, terminal: { rows: 40, columns: 100 } },
	theme,
	keybindings: { matches: () => false },
	done: () => {},
	onExpire: () => {},
});

selector.render(100);
selector.dispose();

check(
	'metadata labels use muted color',
	painted.some((entry) => entry.color === 'muted' && entry.text === 'File     ') &&
		painted.some((entry) => entry.color === 'muted' && entry.text === 'Why      '),
);
check(
	'folder value uses dim color',
	painted.some((entry) => entry.color === 'dim' && entry.text === '~/.aws/'),
);
check(
	'why value uses warning color',
	painted.some((entry) => entry.color === 'warning' && entry.text === 'contains AWS credentials'),
);
check(
	'finding prefix uses warning color without painting the matched line content',
	painted.some((entry) => entry.color === 'warning' && entry.text === 'Finding  42: ') &&
		!painted.some((entry) => entry.text.includes('KEY=example')),
);
check(
	'countdown footer uses warning color',
	painted.some((entry) => entry.color === 'warning' && entry.text.startsWith('Default: No (')),
);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
