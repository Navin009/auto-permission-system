# Thinking stays Pi's, the row never spans it

**Status: shipped.** `src/core/tool-view/row-group.ts`, `src/tool-view/row-groups.ts`, plus
`security/tests/unit/tool-view-thinking-rows.mjs` and `tool-view-wiring.mjs`. Supersedes `8e2d824`
("a streaming thought is a line inside the row") and `399bc61` ("a thought takes no line at all").
`plan/tool-rows-views.md` §5 and rules 7-8 follow it.

The rule, in one line: **the thought is Pi's block, drawn exactly as Pi draws it; our row ends where
the thought starts and a new row begins after it.**

- Nothing of ours draws, hides, relabels or re-styles a thought: no `setHiddenThinkingLabel`, no
  markdown transformer, no `Thinking...` line, no captured thought text, no click of our own.
- A command that arrives after a thought opens a **new** row. The row above the thought folds to
  one line and stays where it was.
- The only thing we add is the `(thinking Ns)` bracket on the live row's header, so a row that is
  waiting on the model does not look frozen.
- A thought that arrives while a command is still running never folds that command away: the row
  waits for the running call to settle before it lets go.

Words used here: **row** (or frame/group) = the block that starts with `✓ Running 8 commands · 40s`
and owns the lines under it.

---

## 1. Why the row and the thought cannot be one thing

This is the constraint that decided the design, and it is worth stating plainly because three
earlier commits tried to work around it:

1. **The row is one mounted component.** It is created by a tool call's renderer and inserted into
   the transcript as a single child, at the position of that tool call. Everything it draws —
   header, `└` lines, and previously the `Thinking...` line — must be inside that one child's
   `render()` output.
2. **A thought is a different child, at a different position.** Pi inserts its thinking block into
   the same transcript container, after the assistant message that carried it. It is not ours, and
   a component cannot draw into a sibling's slot: there is no API to mount anything between them.
3. Therefore a row and a visible thought can only relate in one of three ways, and each has a cost:

| Option | What it looks like | Why we did not ship it |
| --- | --- | --- |
| Row grows past the thought | `└` lines appear above the block that arrived after them | reads backwards; the transcript lies about order |
| Row is re-mounted at its newest command | the row moves down past the thought; every thought piles up above it | thoughts stack at the top of the transcript, one row sinks below them |
| Thought takes no line at all | cleanest rows, one row per run | needs `setHiddenThinkingLabel("")` — it removes Pi's own block, its click and its text |

`8e2d824` tried a fourth way — draw our own `Thinking...` line inside the row — which looked fine
until you clicked it: it could show that something was being thought, but not what, and it was not
Pi's block, so it could not behave like it either. That line is gone.

The shipped answer is the honest one: **do not fight for the same space.** The thought keeps its own
slot, unchanged; the row keeps its own, and ends where the other begins.

## 2. The model

```text
Row
  members: RowMember[]                   commands only, unchanged
  thoughtRevisionAtNewestMember: number  the thought count when the row last took a command
```

`groupForCall()` asks `splitsAfterThought(currentGroup)` before joining a command to the open row:
if `thoughtRevision()` has moved past the row's recorded revision and no command in the row is still
running, the call starts a new group, and `createGroup` folds the previous one to a single line.

`groupSummary` passes the live thought only for the open row, so the bracket cannot light up on a
row that is already finished.

## 3. Your transcript, after the change

**A thought between two commands** — one row above it, folded, and a new row for the command after:

```text
✓ Running 3 commands (npm run build) ctrl+o to expand · 12s

 Thinking...
   The split rule only fires when the row's recorded revision is older than the
   current thought count, so a thought that arrives mid-command changes nothing.

● Running 1 command · 1s
  └ … $ npm run lint
```

**A thought while a command is still running** — no split, because a running call must never be
folded out of sight; the header keeps counting and carries the bracket:

```text
● Running 2 commands (thinking 4s) · 6s
  └ ✓ $ npm test 1.4s
  └ … $ npm run build
```

**A thought with nothing after it** — the row stays exactly as it was, folded or open:

```text
✓ Running 3 commands (npm run build) ctrl+o to expand · 12s
```

**The answer starts streaming** — text closes the row as it always did; Pi's thought block stays
where it streamed, readable and clickable as Pi made it.

## 4. What this needs in the code

| Piece | Where | Change |
| --- | --- | --- |
| split rule | `src/tool-view/row-groups.ts` | `splitsAfterThought()` no longer waits for Pi to render a block; it is the only rule, for every kind |
| bracket | `src/tool-view/thinking-clock.ts` | `beginThinking`/`endThinking`/`thoughtRevision`/`thinkingState` only — no text, no expansion, no hidden flag |
| header | `src/core/tool-view/row-group.ts` | `(thinking Ns)` in the target slot while the open row waits; no thought line of any kind |
| Pi's block | — | untouched: no label write, no transformer, no re-style |
| click | `src/tool-view/row-group-component.ts` | one handler again: a click anywhere in the row walks the row's ladder |

What was deleted with the previous design: `thinking-visibility.ts` entirely, `streamingThoughtText`,
`collapseThought`, the thought-line fields on `RowGroupSummary`/`RowLine`, the body wrapper in the
component, and the hit test that routed a click to `toggleThoughtExpansion()`.

## 5. What it costs

- **A run can show several rows.** One thought between commands means one extra row header; a busy
  turn can show three or four. This is the price of leaving Pi's block alone, and it is visible at a
  glance: a folded row is one line.
- **A row's timer covers only its own commands.** The seconds do not span a thought, so two rows in
  one turn add up to less than the turn.
- **The bracket is ours and it is brief.** It is the only thinking signal we add; Pi's block below
  the row is the thing you read and open.

## 6. The header bracket stays

It survives a folded row, which is exactly when it is needed — the row is one line and the model is
still working:

```text
● Running 1 command (thinking 10s) · 40s
  └ … $ npm run build
```

It appears at `beginThinking()` and leaves at `endThinking()`; it is never counted, never timed, and
never restarts the row's own `· Ns`.

## 7. Tests this needs

| Test | Asserts |
| --- | --- |
| `unit/tool-view-thinking-rows.mjs` | a thought draws no line inside the row and the row never writes `Thinking`; the bracket rides the open row and leaves with the thought; a thought between two commands ends the row, folds it, and starts the next at its own command; a thought while a command runs never splits; a thought with no command after it changes nothing; a read run behaves the same |
| `unit/tool-view-thinking.mjs` | the stream is detected, the thinking part ticks, and the revision the split rule reads moves once per thought |
| `unit/tool-view-live-duration.mjs` | a row counts while a thought streams and resumes after it; the row above a thought folds on its own command |
| `unit/tool-view-frame-ownership.mjs` | a row is owned by its first command for as long as it lasts |
| `contract/tool-view-wiring.mjs` | a command after a thought opens its own row; the extension never writes `setHiddenThinkingLabel` on session start, view switch or render |
| `contract/tool-view-registry.mjs` | a streaming thought adds no line to the row, and no `thinkingText` styling comes from us |
