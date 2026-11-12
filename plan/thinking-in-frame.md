# Thinking inside the group

**Status: shipped.** `src/core/tool-view/row-group.ts`, `src/tool-view/row-groups.ts`, plus
`security/tests/unit/tool-view-thinking-rows.mjs` and `tool-view-thinking-regimes.mjs`.
Supersedes `399bc61` ("a thought takes no line at all"). `plan/tool-rows-views.md` §5 and rules 7-8
follow it.

The rule, in one line: **`Thinking...` is a live line of its own at the bottom of the open row, a
click opens the streamed thought under it, and a command joining the row hides it.**

- The row never breaks at a thought. One row per run of commands, whatever happens in between.
- While a thought streams, the open row shows one `  Thinking...` line under its last command,
  drawn in Pi's own style — `thinkingText` colour, italic.
- The line carries its own click and its own state: a click on it opens the streamed thought under
  it, a second click closes it. It never advances the row's ladder — a click on the header does
  that, and a click on a `└` line still belongs to the ladder too.
- A command joining the row hides the line and its opened text, even while the thought is still
  streaming; the bracket keeps ticking on the header, which is the row's other live signal.
- The next thought starts a fresh line, collapsed, in the same row.
- Pi's own thinking block is blanked (`setHiddenThinkingLabel("")`, session-wide in compact) so the
  line is the only copy; the text reaches the row through the `message_update` deltas.

Words used here: **row** (or frame/group) = the block that starts with `✓ Running 8 commands · 40s`
and owns the lines under it.

---

## 1. What you saw, twice

Rows drawn above a later thought (the original fault):

```text
✓ Running 4 commands · 12s
  └ ✓ $ git log --oneline -12 && ls 81ms
  └ ✗ $ ls src/core extensions security tests 2>/dev/null 105ms
  └ ✓ $ ls src/core/policy && grep -rn "\.env" … 3.4s
  └ ✓ $ grep -rn "env" sandbox.default.json 42ms

 Thinking...
```

Thoughts piled up after the row was moved to its newest command:

```text
 Thinking...

 Thinking...

 Thinking...

 Thinking...

● Running 8 commands (thinking 10s) · 40s
  └ ✗ $ sed -n 1,60p plan/scrollable-script-plan.md; echo ---; ls extensions src/core tests 2>/dev/null 137ms
  └ ✓ $ wc -l extensions/*.ts src/core/*.ts tests/*.mjs 2>/dev/null | tail -30; echo ---; grep -rn "Reading" … -40 149ms
  …
```

Both exist because a visible pi block cannot sit inside a row: a row that spans one has to grow past
it or move past it. Take the block away and neither can happen.

## 2. The model

```text
Row
  members: RowMember[]         commands only, unchanged
  liveThought: boolean         true while a thought streams and no command has joined it
  liveThoughtText: string      the streamed text, collapsed to one line
  liveThoughtExpanded: boolean the thought line's own open state
```

`rowGroupLines` appends the live line after the command lines — `  Thinking...`, no mark, no
`$`, no duration, not counted — and only for a kind that draws child lines at all (`shell`,
`read`). The line carries `thoughtText` and `thoughtExpanded`, and `RowGroupComponent` wraps that
text into at most six body lines under the line when it is open, styled like Pi's block.

The flag is `thinkingState() !== undefined && !thoughtLineHidden() && !thoughtsRenderAsBlocks()`.
Hiding is `thinking-clock`'s `hideThoughtLine()`, fired when a call joins the group's member list;
`beginThinking()` clears it, so the next thought draws the line again. The third term matters for
the visible-thinking regime (§5): when pi is set to show thinking, the italic block is on screen
already and compact must not add a second copy.

## 3. Your transcript, after the change

**A thought streams while the row is open** — the state you called fine, drawn by the row instead of
by pi:

```text
● Running 4 commands (thinking 10s) · 40s
  └ ✓ $ sed -n 1,60p plan/scrollable-script-plan.md; echo ---; ls … 137ms
  └ ✓ $ wc -l extensions/*.ts … | tail -30; echo ---; grep -rn "Reading" … 149ms
  └ ✓ $ ls -la src/core/tool-view && wc -l … 134ms
  └ ✓ $ sed -n 1,120p src/core/tool-view/row-group.ts 159ms

  Thinking...
```

**Click the line** — the thought opens under it, and the row around it does not move; a second
click puts it back:

```text
● Running 4 commands (thinking 10s) · 40s
  └ ✓ $ sed -n 1,60p plan/scrollable-script-plan.md; echo ---; ls … 137ms
  └ ✓ $ sed -n 1,120p src/core/tool-view/row-group.ts 159ms

  Thinking...
    The row needs one line it can open on its own, so the thought text has to
    come from the stream and the click must not walk the row's ladder…
```

**A command joins the row** — the line and its opened text go; the bracket keeps the header live:

```text
● Running 8 commands · 40s
  └ ✓ $ sed -n 1,60p plan/scrollable-script-plan.md; echo ---; ls … 137ms
  └ ✓ $ wc -l extensions/*.ts … | tail -30; echo ---; grep -rn "Reading" … 149ms
  └ ✓ $ ls -la src/core/tool-view && wc -l … 134ms
  └ ✓ $ sed -n 1,120p src/core/tool-view/row-group.ts 159ms
  └ ✓ $ cat src/core/tool-view/expansion-level.ts && … 197ms
  └ ✓ $ sed -n 120,249p src/core/tool-view/row-group.ts; … 143ms
  └ ✓ $ sed -n 1,91p extensions/tool-view.ts; … 464ms
  └ … $ wc -l src/tool-view/*.ts && sed -n 1,80p … 128ms
```

Compare with your paste: no ` Thinking...` blocks stacked above, no second header, no line inside the
row for a thought that has finished. Four thoughts happened; none of them left a mark.

**A thought completes with no command after it** — the line still goes, and the row waits as it is:

```text
✓ Running 8 commands (sed -n 1,80p src/tool-view/row-groups.ts) · 40s
  └ … $ wc -l src/tool-view/*.ts && sed -n 1,80p src/tool-view/row-groups.ts 128ms
```

**The answer starts streaming** — text closes the row and it folds to one line; nothing was left
behind to fold:

```text
✓ Running 8 commands (sed -n 1,80p src/tool-view/row-groups.ts) ctrl+o to expand · 40s

Here is what I found. The row code lives in three files…
```

**The start of a turn, before any command** — this is the one place the live line cannot appear:
there is no row yet to hold it, and pi's block is blanked. Pi's working indicator still animates.

## 4. What this needs in the code

| Piece | Where | Change |
| --- | --- | --- |
| thought text | `src/core/tool-view/message-text.ts` | `streamingThoughtText()` reads the trailing thinking blocks, joined with a blank line |
| line state | `src/tool-view/thinking-clock.ts` | `beginThinking(text)` keeps the newest text; `thoughtExpanded()` / `toggleThoughtExpansion()` hold the line's own open state; `hideThoughtLine()` is cleared by the next thought |
| hide on join | `src/tool-view/row-groups.ts` | `ensureMember` calls `hideThoughtLine()` when a call joins a row that already has members, so the line ends where the command lands |
| live flag | `src/tool-view/row-groups.ts` | `groupSummary` passes `liveThought`, `liveThoughtText` and `liveThoughtExpanded` for the open row only |
| one line + body | `src/core/tool-view/row-group.ts` | `rowGroupLines` appends `  Thinking...` when the flag is set and the row is not folded, carrying the text and its open state |
| own click | `src/tool-view/row-group-component.ts` | the rendered line kinds are remembered, so a click on a thought line or its body toggles the thought and a click anywhere else advances the row's ladder |
| repaint | `src/tool-view/renderers.ts` | the row already repaints on the 1 s thinking tick; `endThinking()` / `hideThoughtLine()` repaint once |
| label + anchor | already shipped in `399bc61` | `setHiddenThinkingLabel("")` for compact (default restored for full); the row is drawn from its first command and never moves |

Small on purpose: no `└` line of its own, no text stored past the live thought, no ordering, no
split.

## 5. What it costs

- **The opened thought is not remembered.** It is a view of the live stream: once the thought
  completes, or a command joins the row, the text is dropped and compact cannot bring it back.
  (`/tool-view full` shows Pi's blocks as always.)
- **The start of a turn shows no thinking line**, because no row exists yet. Pi's spinner is the
  only feedback for that first stretch.
- **The body is capped at six wrapped lines**, tail first, with `…` above when it was cut. It is a
  glance at what the model is doing, not a transcript.
- A thought between two *different* kinds of call ends with the row it streamed under: the line
  goes, the new row starts after it.

## 6. The header bracket stays

Both signals are on screen while a thought streams — that is the shipped choice:

```text
● Running 4 commands (thinking 10s) · 40s
  Thinking...
```

The bracket is the live timer and survives a folded row, where the body line is hidden; the body
line is the thing you read and open. They appear together at `beginThinking()`, and they part ways
on the two different endings: `endThinking()` drops both, while a command joining the row drops
only the body line — the bracket stays up because the model may still be thinking.

## 7. Tests this needs

| Test | Asserts |
| --- | --- |
| `unit/tool-view-thinking-rows.mjs` | a streaming thought adds `  Thinking...` at the bottom, in Pi's style, with no mark and no `$`; the line carries the collapsed thought text and starts closed; `toggleThoughtExpansion()` opens and closes it; a joining command hides the line and drops its text, the bracket stays, and the next thought brings the line back collapsed; `endThinking()` removes both; a command after a thought adds one `└` line and no thought line; the thought is never counted; a read row draws the line too; no body line in the visible regime |
| `unit/tool-view-thinking.mjs` | the streamed text is readable, two blocks join, a finished thought has none, and the clock holds hide/expand state per thought |
| `unit/tool-view-thinking-regimes.mjs` | hidden: one row across a thought; visible: a rendered thought ends the row and folds it, and never folds away a running command |
| `unit/tool-view-frame-ownership.mjs` | the row is owned by its first command across any number of thoughts |
| `contract/tool-view-registry.mjs` | a click on the thought line opens and closes the thought without touching the header or the row's ladder, a click on the header still advances the ladder, and the opened body takes `thinkingText` |
| `contract/tool-view-wiring.mjs` | the label is blanked once per session in compact and restored in full; a hidden thought never opens a new row |
