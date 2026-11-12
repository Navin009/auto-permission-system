# Pi-native thinking inside one command group

**Status: shipped.** `src/tool-view/native-thinking.ts`, `src/tool-view/row-groups.ts`,
`src/tool-view/renderers.ts`, `src/tool-view/thinking-clock.ts`, plus
`security/tests/unit/tool-view-native-thinking.mjs` and `security/tests/contract/tool-view-wiring.mjs`.
Supersedes `549d55b` ("leave Pi's thinking block alone and end the row at it").
`plan/tool-rows-views.md` §5 and rules 7-8 follow it.

The rule, in one line: **an active thought stays Pi-native; the next compatible tool call suppresses
that thought in the normal transcript and joins the existing group, whose native expansion retains
Pi-native `Thinking...` rows.**

- While a thought is active, Pi owns its label, text, click, colour, italics and spacing. Clicking it
  opens the real streamed thought exactly as it does without this extension.
- The thought is never a group member or a compact child line: no `└`, no `$`, no command count.
- A following call of the same row kind joins the existing group once commands have settled. Each
  intervening thought becomes zero-height in the ordinary transcript and the command count grows.
- At the Pi-native rungs of the group expansion ladder, the saved thought reappears in its original
  position. It is another real `AssistantMessageComponent`, so its `Thinking...` label and click to
  reveal behave natively; its click never advances the group ladder.
- Text, `write`, another tool kind or a user message still closes the group. In those cases the
  native thought stays in the ordinary transcript.
- A thought never folds or suppresses an earlier command that is still running.
- An assistant message that cannot be captured keeps the old safe split rather than risking commands
  being drawn above a visible thought. `full` does no capture-driven suppression at all.

Words used here: **row** (or frame/group) = the block that starts with `✓ Running 8 commands · 40s`
and owns the compact lines under it.

---

## 1. Why two representations are necessary

A row and a thought are separate transcript components. If the original thought keeps occupying
space between two calls, one group mounted at the first call would draw its later lines above that
space. Moving the row below the thought instead reintroduces the old pile-up of thoughts.

The group therefore has two views of the same sequence:

| View | Commands | Thoughts between commands |
|---|---|---|
| row / grouped compact view | one header and one `└` line per command | not drawn |
| Pi native collapsed / full output view | Pi's own call/result blocks | Pi's own native components, in order |

Suppressing a thought from the normal transcript does **not** delete its content or remove it from
the group's native expansion.

## 2. Active thinking is untouched

Given two settled commands followed by a thought, the open group stays where it is. Pi renders its
own component below it:

```text
● Running 2 commands (thinking 4s) · 6s
  └ ✓ $ head -200 plan/tool-rows-views.md 91ms
  └ ✓ $ sed -n '1,40p' src/tool-view/renderers.ts 24ms

 Thinking...
```

Clicking `Thinking...` is Pi's click, not a group click:

```text
  I should keep these commands in one group and preserve the thought for native
  expansion rather than splitting the run...
```

An active thought with no following call remains visible and clickable like this. A thought-only
turn likewise remains Pi's own transcript, without a row.

## 3. The next compatible call joins the group

When the third command arrives, the intervening thought leaves no line or spacer in the ordinary
transcript. The original group gains that command in place:

```text
● Running 3 commands · 7s
  └ ✓ $ head -200 plan/tool-rows-views.md 91ms
  └ ✓ $ sed -n '1,40p' src/tool-view/renderers.ts 24ms
  └ … $ npm test
```

After another thought and another command, it is still one group:

```text
✓ Running 4 commands (npm run build) ctrl+o to expand · 12s
```

There are no alternating `Running` / `Thinking...` headers in the folded transcript. The header's
`(thinking Ns)` bracket remains the only live thinking signal in the compact group while a thought
streams, and it still survives a folded row.

## 4. Native expansion retains the thoughts

The first expansion rung after a fold is still just the compact `└` command list. Continuing to the
Pi-native levels restores the real order, including thinking rows:

```text
bash
  head -200 plan/tool-rows-views.md
──────────────────────────────────────────
<file contents>

 Thinking...

bash
  sed -n '1,40p' src/tool-view/renderers.ts
──────────────────────────────────────────
<file contents>

 Thinking...

bash
  npm test
──────────────────────────────────────────
<test output>
```

Click either `Thinking...` and its native component opens the saved thought text. Styled Markdown,
padding and spacing come from Pi. The saved component follows the preceding command's native block;
it is not accumulated at the start or end of the group.

Once a command has suppressed a thought in the ordinary transcript, that thought is reopened through
the group's native expansion rather than through the now-empty original transcript slot.

## 5. The model

```text
RowGroup
  members: RowMember[]                        commands/read calls only
  thoughtRevisionAtNewestMember: number       revision boundary for the next joining call

RowMember
  nativeThoughts: AssistantMessageComponent[] thoughts after this call, before the next member
```

`native-thinking.ts` is the isolated host bridge. It observes Pi's `AssistantMessageComponent`
updates, associates a streamed thought with its actual component, and preserves that component's
Markdown theme, output padding, transformers and metadata for its native expansion.

Pi has no public per-message suppression API. The bridge therefore changes only the captured
component's own hidden-thinking state to its zero-height form. It does **not** call the global
`setHiddenThinkingLabel`, register a Markdown transformer, hide all thinking or draw thought text
itself. If the host component cannot be captured, grouping falls back to the previous safe split.

On a join, `groupForCall()` asks for every captured thought after the recorded revision. The join is
allowed only when all of them can be suppressed and no command is still running. The saved native
views attach to the **preceding** member before the new member is appended.

At native expansion, each tool's existing Pi call/result `Box` is followed by that member's saved
assistant components inside a `Container`. Pi's nested mouse region handles a thought click first;
the surrounding group mouse region handles only clicks not consumed by a native child.

Switching to `full`, starting a new session or shutting down restores every suppressed original
component's previous display state and clears the saved-history registry.

## 6. Boundaries

| What follows a thought | Old group | Native thought | Result |
|---|---|---|---|
| compatible call, all settled | same group | suppressed; retained for expansion | next `└` member |
| compatible call while something runs | same group | left alone | running work stays visible |
| different row kind | folds | left alone | new kind's group |
| `write`, `edit`, other native tool | folds | left alone | Pi's own tool block |
| assistant text | folds | left alone | Pi's thought, then the text |
| user message | folds | left alone | normal message boundary |

A row's compact count and mark still describe only tool members. The row timer continues while an
active thought streams, as it did before. Nothing in the read-specific rules changes except that a
read run uses this same joining mechanism.

## 7. Tests

| Test | Asserts |
|---|---|
| `unit/tool-view-native-thinking.mjs` | a captured thought joins one group and leaves zero rendering behind; saved native thoughts are ordered after the preceding command; native clicking opens/collapses real thought text without advancing the group; multiple thoughts, running calls and text boundaries behave correctly; reset restores originals; an uncaptured thought splits safely |
| `unit/tool-view-thinking-rows.mjs` | no thought becomes a compact child or receives a mark/count; the bracket lives for the stream; running calls do not split; uncaptured shell and read thoughts retain the safe fallback |
| `unit/tool-view-thinking.mjs` | the stream still starts/stops the clock and advances the revision once per thought |
| `unit/tool-view-live-duration.mjs` | the timer continues through live thinking and resumes with the next member |
| `contract/tool-view-wiring.mjs` | a command after a captured thought joins the same row; the original is suppressed; visible text still closes a group; no global thinking-label writes occur |
| `contract/tool-view-registry.mjs` | the compact renderer never writes a thought line or applies our thought colour |
| `unit/tool-view-pi-view.mjs` | Pi's own call/result frame and component reuse remain unchanged below the group |
