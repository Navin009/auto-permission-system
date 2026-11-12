# Thinking inside the group

**Status: shipped.** `src/core/tool-view/row-group.ts`, `src/tool-view/row-groups.ts`, plus
`security/tests/unit/tool-view-thinking-rows.mjs` and `tool-view-thinking-regimes.mjs`.
Supersedes `399bc61` ("a thought takes no line at all"). `plan/tool-rows-views.md` §5 and rules 7-8
follow it.

The rule, in one line: **`Thinking...` is a live line at the bottom of the open row, and it is gone
the moment the thought completes.**

- The row never breaks at a thought. One row per run of commands, whatever happens in between.
- While a thought streams, the open row shows one dim `  Thinking...` line under its last command.
- The moment the thought completes, that line is dropped. The next command simply adds its line —
  the thought leaves no trace inside the row.
- Nothing accumulates at the top, nothing is drawn above a block that arrived later, and the row
  never moves.
- Pi's own thinking block is blanked (`setHiddenThinkingLabel("")`, session-wide in compact) so the
  live line is the only copy.

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
  members: RowMember[]        commands only, unchanged
  liveThought: boolean        true while a thought streams (and pi is not drawing it itself)
```

`rowGroupLines` appends the live line after the command lines — `  Thinking...`, dim, no mark, no
`$`, no duration, not counted — and only for a kind that draws child lines at all (`shell`,
`powershell`). A `read` row is one line by design, so there it is the bracket alone.

The flag is `thinkingState() !== undefined && !thoughtsRenderAsBlocks()`. The second half matters for
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

**The thought completes and the next command joins the same row** — the line is gone, the command is
one more `└` line, still one header:

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
| live flag | `src/tool-view/row-groups.ts` | expose `thinkingState() !== undefined` to the summary of the open row |
| one line | `src/core/tool-view/row-group.ts` | `rowGroupLines` appends `  Thinking...` when the flag is set and the row is not folded |
| repaint | `src/tool-view/renderers.ts` | the row already repaints on the 1 s thinking tick; `endThinking()` repaints once so the line disappears |
| label + anchor | already shipped in `399bc61` | `setHiddenThinkingLabel("")` for compact (default restored for full); the row is drawn from its first command and never moves |

Small on purpose: no items, no thought text, no click, no ordering, no split.

## 5. What it costs

- **A thought leaves nothing to read.** It shows while it streams, then it is gone; compact cannot
  bring it back. (`/tool-view full` shows pi's blocks as always.)
- **The start of a turn shows no thinking line**, because no row exists yet. Pi's spinner is the only
  feedback for that first stretch.
- A thought between two *different* kinds of call ends with the row it streamed under: the line goes,
  the new row starts after it.

## 6. The header bracket stays

Both signals are on screen while a thought streams — that is the shipped choice:

```text
● Running 4 commands (thinking 10s) · 40s
  Thinking...
```

The bracket is the live timer and survives a folded row, where the body line is hidden; the body
line is the thing you read. They appear and disappear together, at `beginThinking()` and
`endThinking()`, both driven by the same repaint.

## 7. Tests this needs

| Test | Asserts |
| --- | --- |
| `unit/tool-view-thinking-rows.mjs` | a streaming thought adds `  Thinking...` at the bottom, dim, with no mark and no `$`; the header keeps the bracket; `endThinking()` removes both; a command after a thought adds one `└` line and no thought line; the thought is never counted; a read row never grows a body line; no body line in the visible regime |
| `unit/tool-view-thinking-regimes.mjs` | hidden: one row across a thought; visible: a rendered thought ends the row and folds it, and never folds away a running command |
| `unit/tool-view-frame-ownership.mjs` | the row is owned by its first command across any number of thoughts |
| `contract/tool-view-wiring.mjs` | the label is blanked once per session in compact and restored in full; a hidden thought never opens a new row |
