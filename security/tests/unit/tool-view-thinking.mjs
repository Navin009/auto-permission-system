import { carriesStreamingThought, carriesVisibleText } from '../../../src/core/tool-view/message-text.ts';
import { elapsedSeconds, thinkingPart } from '../../../src/core/tool-view/thinking.ts';
import { beginThinking, endThinking, resetThinking, thinkingState } from '../../../src/tool-view/thinking-clock.ts';

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
