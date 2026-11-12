# Thinking and the frame

**Status: shipped.** `src/tool-view/row-groups.ts`, `src/tool-view/renderers.ts`,
`extensions/tool-view.ts`, plus `security/tests/unit/tool-view-thinking-rows.mjs`,
`tool-view-live-duration.mjs`, `security/tests/contract/tool-view-registry.mjs` and
`tool-view-wiring.mjs`.

The rule that shipped: **a frame is drawn by its newest member.** The component is mounted at the
last call of the run instead of the first, so it always renders *below* anything that arrived before
it — a thought can no longer end up under a row that ran after it, because no row is ever drawn above
it. The previous mount goes empty when a new call takes the drawing over.

Two things a thought is not allowed to be: a row of ours (pi draws it, always), and a reason to hide
it (the host cannot hide one thought, §7).

Words used here: **frame** = the block that starts with `✓ Running 3 commands · 4s` and owns the
lines under it (the other docs call it a row or a group).

---

## 1. What you saw

```text
✓ Running 2 commands (cat package.json) ctrl+o to expand · 3.4s

 Thinking...

✓ Running 1 command (wc -l plan/*.md src/core/tool-view/* extensions/tool-view.ts) ctrl+o to expand · 76ms
```

One run of three commands, split into two frames by the thought between them. The fault underneath
it was worse in the earlier trace: when the frame was still open, the next command joined it and the
`└` line appeared **above** the thought:

```text
✓ Running 4 commands · 12s
  └ ✓ $ git log --oneline -12 && ls 81ms
  └ ✗ $ ls src/core extensions security tests 2>/dev/null 105ms
  └ ✓ $ ls src/core/policy && grep -rn "\.env" … 3.4s
  └ ✓ $ grep -rn "env" sandbox.default.json 42ms
```

with `Thinking...` stranded *below* row 4 — a row that ran before the thought.

## 2. Who paints what, line by line

| On screen | Painted by | Anchored at |
| --- | --- | --- |
| your message | pi | its own transcript entry |
| `Thinking...` / the italic thought | pi, from the `thinking` block of the assistant message | its position in the message stream |
| assistant text | pi | its own block |
| `✓ Running 3 commands · 4s` | `RowGroupComponent.render` → `rowGroupLines` | **the newest tool call of the frame** |
| `  └ ✓ $ … 81ms` | same component, one line per member | same slot |
| `read` / `write` / `edit` output | pi's own renderers | its own tool call |

## 3. Root cause, in one sentence

> A frame mounted at its *first* call can only ever render above anything that arrived after that
> call — while it keeps absorbing calls that arrive later.

1. **Stranding.** The thought arrives after call 3 → a pi block at slot 4. Call 4 joins the frame at
   slot 1 → the frame gains a line at slot 1, and slot 4 is already taken.
2. **It reads backwards.** `└ ✓ grep … 42ms` above `Thinking...` says the model grepped before it
   thought.
3. **The collapse only took one thing.** `joinRowGroup` had no notion of a thought, so the only thing
   it could pull in was the command.
4. **The timer double-counted.** `· 12s` spans the commands *and* the idle thought.

## 4. The model that shipped

### 4.1 The frame is drawn by its newest member

`drawsFrame(group, toolCallId)` is true only for `group.members.at(-1)`. Every other member's renderer
returns an empty component, so exactly one mount on screen carries the frame — and it is always the
last call of the run. When a call joins, the previous drawer is invalidated in the same pass, so it
empties as the new one paints.

```text
while the thought streams            the third command lands, all rows below the thought

● Running 2 commands (thinking 2s) · 5s   Thinking...
  └ ✓ $ cat package.json 2.0s
  └ ✓ $ cat src/tool-view/row-groups.ts   ● Running 3 commands · 1s
                                            └ ✓ $ cat package.json 2.0s
 Thinking...                                └ ✓ $ cat src/tool-view/row-groups.ts 1.4s
                                            └ … $ wc -l plan/*.md …
```

Settled and folded:

```text
 Thinking...

✓ Running 3 commands (wc -l plan/*.md … extensions/tool-view.ts) ctrl+o to expand · 4s
```

Two blocks, one header, one `ctrl+o` for the run. The cost is stated in §6.

### 4.2 The five invariants

**I1 — nothing is drawn above a block that arrived later.** The frame lives at its newest call, so a
thought is always immediately above the frame, never under one of its rows.

**I2 — one paint, one array.** Count, `└` lines and the overflow line all come from `members` in one
`rowGroupLines` call, so `4 commands` can never sit above three command lines.

**I3 — a thought is drawn exactly once, by pi.** Never restyled, never blanked, never a row of ours.

**I4 — a thought is not a command.** It never enters the count, never sets the mark, never takes a
`$` line, never restarts a frame's duration.

**I5 — boundaries.** A thought never closes a frame. Assistant text closes it the moment it starts
streaming (not at `turn_end`). A user/steering message, a call of a different kind, a non-row tool
(`write`, `edit`, `codemode`) and the end of the turn close it.

### 4.3 Boundaries as implemented

| Event | Frame |
| --- | --- |
| thought starts while a frame is open | stays open; pi draws the block below it, header takes the `(thinking Ns)` bracket |
| thought finishes | stays open; the block stays below it |
| same-kind call starts | joins; **the drawing moves to it**, the previous mount empties |
| call of a different kind, or a non-row tool | closes / new frame |
| assistant text starts streaming (`message_update`) | closes |
| user or queued (`Steering:` / `Follow-up:`) message | closes |
| `turn_end`, `session_shutdown` | closes / resets |

### 4.4 What the `· 12s` means

Wall clock from the frame's first call to its last activity. It keeps ticking while something is live
— a running command or a streaming thought — and freezes at the last settle, so the frame reports the
step, not the next one.

## 5. Event → action, as wired

| pi event / call | Where | Action |
| --- | --- | --- |
| `message_update`, trailing `thinking` | `extensions/tool-view.ts` | `beginThinking()` |
| `message_update`, no trailing `thinking` | same | `endThinking()` |
| `message_update`, a text block | same | `closeRowGroup()` — the reply closes the frame as it starts streaming |
| `message_start`, role `user` | same | `closeRowGroup()` |
| `turn_end`, message carries text | same | `closeRowGroup()` (safety net) |
| row tool call | `src/tool-view/renderers.ts` | `joinRowGroup` then `rowComponent`, gated by `drawsFrame` |
| — | `src/tool-view/row-groups.ts` | `invalidateFrame()` repaints the newest member when any other member changes; `ensureMember` invalidates the previous drawer on join |
| non-row tool | `extensions/tool-view.ts` | `closeRowGroup()` |
| `session_start` / `session_shutdown` | same | reset frames and the thought clock |

## 6. The reported turn, after the change

**Step 1 — the thought starts, no frame yet.** Unchanged:

```text
false .env on commadn asks anslyse it tell me the cause

Thinking...
```

**Step 2 — four parallel commands start.** The thought is above the frame, so there is nothing to
strand; one frame grows under it:

```text
false .env on commadn asks anslyse it tell me the cause

Thinking...

● Running 4 commands · 1s
  └ … $ git log --oneline -12 && ls
  └ … $ ls src/core extensions security tests 2>/dev/null
  └ … $ ls src/core/policy && grep -rn "\.env" …
  └ … $ grep -rn "env" sandbox.default.json
```

**Step 3 — they settle.** Marks swap in place, seconds freeze:

```text
✓ Running 4 commands (head -40) · 3s
  └ ✓ $ git log --oneline -12 && ls 81ms
  └ ✗ $ ls src/core extensions security tests 2>/dev/null 105ms
  └ ✓ $ ls src/core/policy && grep -rn "\.env" … 3.4s
  └ ✓ $ grep -rn "env" sandbox.default.json 42ms
```

**Step 4 — a second thought streams while the frame is idle.** The state you called fine: pi's block
at the bottom, the frame does not move:

```text
✓ Running 4 commands (head -40) · 3s
  └ ✓ $ git log --oneline -12 && ls 81ms
  └ ✗ $ ls src/core extensions security tests 2>/dev/null 105ms
  └ ✓ $ ls src/core/policy && grep -rn "\.env" … 3.4s
  └ ✓ $ grep -rn "env" sandbox.default.json 42ms

Thinking...
```

**Step 5 — the thought finishes and the next command lands.** The frame re-mounts below the thought
with every row of the run, one header:

```text
 Thinking...

● Running 5 commands · 1s
  └ ✓ $ git log --oneline -12 && ls 81ms
  └ ✗ $ ls src/core extensions security tests 2>/dev/null 105ms
  └ ✓ $ ls src/core/policy && grep -rn "\.env" … 3.4s
  └ ✓ $ grep -rn "env" sandbox.default.json 42ms
  └ … $ npm run typecheck
```

**Step 6 — the answer starts streaming.** Text closes the frame and folds it:

```text
 Thinking...

✓ Running 5 commands (npm run typecheck) ctrl+o to expand · 8s

The `.env` was read through the guard, not the sandbox: `read(".env")` matches the L2
ask rule before L1 ever sees a path…
```

**Step 7 — no further command, only the answer.** The thought stays pi's block, the frame folds
under it:

```text
✓ Running 4 commands (head -40) ctrl+o to expand · 3s

 Thinking...

Good — nothing else to check. Here is what I found…
```

### What step 5 costs, plainly

- The rows above the thought **jump down past it** at the moment the next command arrives: the old
  mount empties, the new mount draws the whole list. Height changes on every join.
- The thought is always immediately **above** the frame, never between two of its rows. Putting it
  between row 2 and row 3 needs pi's block erased, which §7 shows is impossible.
- In exchange the run is one frame with one header and one `ctrl+o`, and no row is ever drawn above
  a block that arrived after it.

## 7. Why the thought cannot be made invisible

Read from the host's own source, `dist/modes/interactive/components/assistant-message.js`,
`updateContent` (≈ lines 124-160):

```js
const hidden = this.thinkingVisibilityOverrides.get(runIndex) ?? this.hideThinkingBlock;
if (hidden && !this.hiddenThinkingLabel.trim()) continue;      // the only zero-spacing path
const thinkingComponent = hidden
  ? new Text(theme.italic(theme.fg("thinkingText", this.hiddenThinkingLabel)), this.outputPad, 0)
  : markdownBlock("thinking", thinking, () => new Markdown(thinking, ..., {
      transform: createMarkdownTransform("assistant-thinking", ...),
    }));
addVisibleChild(new MouseRegion(thinkingComponent, ...));        // adds Spacer(1) before it
```

1. **Default thinking is hidden, and hidden thinking skips markdown entirely.** The
   `registerMarkdownTransformer` hook with `messageType === "assistant-thinking"` only runs in the
   non-hidden branch, so for the default setting it is never called. There is no per-message hook for
   a hidden thought.
2. **Even when it runs, it cannot remove the block.** `addVisibleChild` has already inserted a
   `Spacer(1)`, and the `Markdown` component stays mounted. Returning `""` leaves an empty block and
   a blank line, not zero lines.
3. **The one lever that removes the block is global.** `hidden && !this.hiddenThinkingLabel.trim()`
   gives zero lines *and* zero spacing, but `setHiddenThinkingLabel` walks every assistant component:
   all thoughts or none, and handing it back re-renders every past thought at once — the fault that
   made `fc170fc` revert `6def983`.

## 8. Alternatives, and why this one won

| Option | Shape | Why not |
| --- | --- | --- |
| Frame mounted at its **first** call | rows above a later thought | The fault in §3 |
| **Take the thought, draw one frame, hide the thought** | five rows, no thought line | Impossible: §7 |
| Hide all thoughts (`setHiddenThinkingLabel("")`) | one frame, no `Thinking...` anywhere | Kills the states you called fine, and cannot be undone without resurrecting every past thought |
| Split at the thought (shipped first, then replaced) | two frames, thought between | Order is literal and rows never move, but one run gets two headers — you asked for one |
| **Draw from the newest member (shipped)** | one frame below the thought | Rows jump on join and the thought sits above them; every other row is in one block, one header, one `ctrl+o` |

## 9. Why the earlier attempt was reverted, and what is different

`6def983` shipped thought records, a bottom `Thinking...` and adoption of a pre-first-call thought;
`fc170fc` reverted it. None of its faults are reintroduced:

- no `setHiddenThinkingLabel` anywhere — `tool-view-wiring.mjs` asserts the label is never touched;
- no UI context cached across `/resume`, so nothing can throw inside a renderer;
- no `└ ~ thinking` record, so no thought is ever hidden behind a click;
- a thought is never drawn, counted or labelled by us.

## 10. Tests that now hold the behaviour

| Test | Asserts |
| --- | --- |
| `contract/tool-view-registry.mjs` | the newest call draws the frame; an older call's renderer goes empty; the settled newest keeps the drawing; the folded row comes from the newest member |
| `contract/tool-view-wiring.mjs` | a second command joins the same row and the first mount empties; a tool-only turn keeps the group open; streaming text closes the frame before `turn_end`; a command after a thought joins the same row; pi's hidden-thinking label is never touched |
| `unit/tool-view-thinking-rows.mjs` | a streaming thought adds no line and rides the bracket; a command after a thought joins the row above it; one row for the run; the thought is never a row, never counted |
| `unit/tool-view-live-duration.mjs` | the frame keeps counting across a thought; both commands keep their own line; the frame ends on the last settle |
| `unit/tool-view-rows.mjs` | the pure renderer is unchanged — a thought has no line, no count, no mark |

Full suite: `45/45 test files passed`, `npm run typecheck` clean.

## 11. Docs updated with the code

- `plan/tool-rows-views.md` §5 and rule 8: the row follows its newest command and is drawn under the
  thought.
- `README.md` (the `(thinking 4s)` paragraph): same sentence.
- `skills/auto-permission-system/SKILL.md`, `SECURITY.md`: unchanged — policy and layer status did
  not move.

## 12. Not in scope

- Hiding a thought, in any form (§7). The global-label option in §8 would need a new `/tool-view`
  switch and your explicit call.
- Rows for `edit` / `write` / `codemode` in a frame (they close it, as today).
- Keeping the frame's height stable across a join; the mount has to move for I1 to hold.
