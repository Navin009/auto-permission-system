import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

const scratchAgentDir = mkdtempSync(join(tmpdir(), 'allow-notice-'));
process.env.PI_CODING_AGENT_DIR = scratchAgentDir;

const { clearAllowNotices, clearProgramIds, gateSensitiveToolOutput } = await import(
	'#l2-guard/output-gates.ts'
);
const { clearGateNotes, gateNoteFor, rememberGateNote, setGateNoteRepaint } = await import(
	'#shared/gate-notes.ts'
);

const AUDIT_PATH = join(scratchAgentDir, 'audit.log');
const ALLOW_ONCE = 'this once';
const KEEP_HIDDEN = 'keep it hidden';
const CODEMODE_NOTICE = 'Output permitted: allowed codemode output for this call.';
const BASH_NOTICE = 'Output permitted: allowed bash output for this call.';
const imageBlock = { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUg' };
const policy = { mode: 'advanced-secure' };

const event = (toolName, toolCallId) => ({
	toolName,
	toolCallId,
	input: {},
	content: [imageBlock],
	isError: false,
});

const contextFor = (notices, picker = ALLOW_ONCE) => ({
	cwd: '/work/project',
	hasUI: true,
	ui: {
		notify: (message) => notices.push(message),
		select: async (_title, options) => options.find((option) => option.includes(picker)),
	},
});

const auditDecisions = () =>
	existsSync(AUDIT_PATH)
		? readFileSync(AUDIT_PATH, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
		: [];

clearAllowNotices();
clearProgramIds();
clearGateNotes();

const first = [];
const firstResult = await gateSensitiveToolOutput(event('codemode', 'call-1'), contextFor(first), policy);
check('the answer is confirmed to the user', first.length === 1 && first[0] === CODEMODE_NOTICE);
check('an allowed call is not rewritten', firstResult === undefined);
check('an allowed call keeps its warning for the expanded row', gateNoteFor('call-1') === CODEMODE_NOTICE);

const second = [];
await gateSensitiveToolOutput(event('codemode', 'call-2'), contextFor(second), policy);
check('a second allow of the same tool says nothing', second.length === 0);
check('the silent allow is still audited', auditDecisions().filter((entry) => entry.decision === 'yes').length === 2);

const other = [];
await gateSensitiveToolOutput(event('bash', 'call-3'), contextFor(other), policy);
check('a different tool is confirmed again', other.length === 1 && other[0] === BASH_NOTICE);

const hidden = [];
const hiddenResult = await gateSensitiveToolOutput(
	event('codemode', 'call-4'),
	contextFor(hidden, KEEP_HIDDEN),
	policy,
);
check('a hidden answer writes nothing to the chat', hidden.length === 0);
check('a hidden answer withholds the output', hiddenResult?.content?.[0]?.text.includes('was hidden') === true);
check(
	'a hidden call keeps its warning for the expanded row',
	gateNoteFor('call-4') === 'Sensitive data protected: codemode output was hidden from the AI (potential secrets detected).',
);

let repaints = 0;
setGateNoteRepaint(() => {
	repaints++;
});
rememberGateNote('call-repaint', 'a note');
check('a new note repaints the rows that show it', repaints === 1);

const nested = { ...event('codemode', 'call-nested/1'), parentToolCallId: 'call-nested' };
await gateSensitiveToolOutput(nested, contextFor([], KEEP_HIDDEN), policy);
check('a nested answer lands on the call that issued it', gateNoteFor('call-nested')?.includes('Sensitive data protected') === true);
check('a nested answer keeps no note of its own', gateNoteFor('call-nested/1') === undefined);

clearGateNotes();
check('a session reset forgets the warnings', gateNoteFor('call-1') === undefined);

clearAllowNotices();
const afterReset = [];
await gateSensitiveToolOutput(event('codemode', 'call-5'), contextFor(afterReset), policy);
check('a new conversation confirms again', afterReset.length === 1 && afterReset[0] === CODEMODE_NOTICE);

rmSync(scratchAgentDir, { recursive: true, force: true });

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
