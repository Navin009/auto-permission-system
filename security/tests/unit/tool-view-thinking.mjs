import { carriesStreamingThought, carriesVisibleText, streamingThoughtText } from '../../../src/core/tool-view/message-text.ts';
import { collapseThought, elapsedSeconds, thinkingPart } from '../../../src/core/tool-view/thinking.ts';
import {
	beginThinking,
	endThinking,
	hideThoughtLine,
	resetThinking,
	thinkingState,
	thoughtExpanded,
	thoughtLineHidden,
	thoughtText,
	toggleThoughtExpansion,
} from '../../../src/tool-view/thinking-clock.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const state = (elapsedMilliseconds) => ({ startedAt: 1000, now: 1000 + elapsedMilliseconds });
const message = (content) => ({ role: 'assistant', content });

check('a thought at the start reads zero seconds', thinkingPart(state(0)) === '(thinking 0s)');
check('a thought counts whole seconds', thinkingPart(state(3400)) === '(thinking 3s)');
check('a thought truncates a part second', thinkingPart(state(3999)) === '(thinking 3s)');
check('a thought never counts backwards', thinkingPart(state(-5000)) === '(thinking 0s)');
check('a thought survives a broken clock', elapsedSeconds({ startedAt: Number.NaN, now: 10 }) === 0);

check('a streaming thought is the last block', carriesStreamingThought(message([{ type: 'thinking', thinking: 'hmm' }])) === true);
check('a thought followed by text is done', carriesStreamingThought(message([{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'hi' }])) === false);
check('a tool call ends the thought', carriesStreamingThought(message([{ type: 'thinking', thinking: 'hmm' }, { type: 'toolCall', name: 'bash' }])) === false);
check('a string message never thinks', carriesStreamingThought(message('hello')) === false);
check('a message without content never thinks', carriesStreamingThought({ role: 'assistant' }) === false);
check('an empty message never thinks', carriesStreamingThought(message([])) === false);
check('a thought is not visible text', carriesVisibleText(message([{ type: 'thinking', thinking: 'hmm' }])) === false);
check('text after a thought is visible text', carriesVisibleText(message([{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'hi' }])) === true);

check('the thought text is readable while it streams', streamingThoughtText(message([{ type: 'thinking', thinking: 'hmm' }])) === 'hmm');
check('two thinking blocks join into one text', streamingThoughtText(message([{ type: 'thinking', thinking: 'a' }, { type: 'thinking', thinking: 'b' }])) === 'a\n\nb');
check('a finished thought has no text to read', streamingThoughtText(message([{ type: 'thinking', thinking: 'a' }, { type: 'text', text: 'hi' }])) === '');
check('a message without a thought reads empty', streamingThoughtText(message('hello')) === '');
check('a broken block never crashes the text', streamingThoughtText(message([{ type: 'thinking' }])) === '');
check('a thought collapses to one line for the row', collapseThought('  two\n\nlines\t here ') === 'two lines here');

resetThinking();
beginThinking();
check('a thought without text stays empty', thoughtText() === '');
beginThinking('a live thought');
check('a streaming thought keeps its text', thoughtText() === 'a live thought');
beginThinking('a live thought, grown');
check('each delta replaces the text with the newest one', thoughtText() === 'a live thought, grown');
check('a fresh thought line starts collapsed', thoughtExpanded() === false);
toggleThoughtExpansion();
check('a thought line expands on its own', thoughtExpanded() === true);
toggleThoughtExpansion();
check('a second click collapses it back', thoughtExpanded() === false);
toggleThoughtExpansion();
hideThoughtLine();
check('a command joining the row hides the line', thoughtLineHidden() === true);
check('hiding the line collapses it', thoughtExpanded() === false);
toggleThoughtExpansion();
check('a hidden line cannot be expanded', thoughtExpanded() === false);
check('a hidden line keeps the bracket clock', thinkingState() !== undefined);
endThinking();
check('ending clears the text', thoughtText() === '');
check('ending clears the hidden flag', thoughtLineHidden() === false);
beginThinking('the next thought');
check('the next thought comes back visible', thoughtLineHidden() === false && thoughtText() === 'the next thought');
endThinking();

resetThinking();
check('no thought before one starts', thinkingState() === undefined);
beginThinking();
const first = thinkingState();
check('a started thought has a start time', typeof first?.startedAt === 'number');
check('a started thought reads the current clock', typeof first?.now === 'number');
beginThinking();
check('a running thought is never restarted', thinkingState().startedAt === first.startedAt);
endThinking();
check('a finished thought is gone', thinkingState() === undefined);
endThinking();
check('ending twice is harmless', thinkingState() === undefined);
beginThinking();
resetThinking();
check('a reset clears the thought', thinkingState() === undefined);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
