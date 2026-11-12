# Thinking and the frame

**Status: shipped.** `src/tool-view/thinking-clock.ts`, `src/tool-view/row-groups.ts`,
`extensions/tool-view.ts`, plus `security/tests/unit/tool-view-thinking-rows.mjs`,
`tool-view-live-duration.mjs` and `security/tests/contract/tool-view-wiring.mjs`.

One thing in the reviewed draft did not survive contact with the host: **a thought cannot be made
invisible.** Pi renders a hidden thought as a plain `Text`, so the only per-message hook an extension
has never runs, and the global label is all-or-nothing (§7). So the frame never *takes* a thought —
it **stops at one**. The fault you reported is fixed: a row can no longer be drawn above a thought
that came after it, because a command that follows a thought opens a new frame instead of growing the
old one.

Words used here: **frame** = the block that starts with `✓ Running 4 commands · 12s` and owns the
lines under it (the other docs call it a row or a group).

---

## 1. The turn as it drew for you

```text
false .env on commadn asks anslyse it tell me the cause

Thinking...
```

```text
✓ Running 4 commands · 12s
  └ ✓ $ git log --oneline -12 && ls 81ms
  └ ✗ $ ls src/core extensions security tests 2>/dev/null 105ms
  └ ✓ $ ls src/core/policy && grep -rn "\.env" --include=*.ts src extensions | head -50 3.4s

Thinking...
```

```text
✓ Running 4 commands · 12s
  └ ✓ $ git log --oneline -12 && ls 81ms
  └ ✗ $ ls src/core extensions security tests 2>/dev/null 105ms
  └ ✓ $ ls src/core/policy && grep -rn "\.env" --include=*.ts src extensions | head -50 3.4s
  └ ✓ $ grep -rn "env" sandbox.default.json | head -40 42ms
```

The thought at the bottom is fine until the next command lands. Then the command is drawn in the
frame **above** the thought, the thought is left stranded under rows that ran before it, and the next
thought opens another block below — frame, thought, frame, instead of one block per step.

## 2. Who paints what, line by line

| On screen | Painted by | Anchored at |
| --- | --- | --- |
| your message | pi | its own transcript entry |
| `Thinking...` / the italic thought | pi, from the `thinking` block of the assistant message | its position in the message stream |
| assistant text | pi | its own block |
| `✓ Running 4 commands · 12s` | `RowGroupComponent.render` → `rowGroupLines` | **the tool call that opened the frame** |
| `  └ ✓ $ … 81ms` | same component, one line per member | same slot |
| `read` / `write` / `edit` output | pi's own renderers | its own tool call |

A frame is a single pi component mounted at the slot of its first call; later calls join it there
(`rowGroupOfCall` → `joinRowGroup`). The component repaints in place — its height grows downward, its
top never moves.

## 3. Root cause, in one sentence

> The live frame is anchored at its first call, so it can only ever render *above* anything that
> arrived after that call — while it keeps absorbing calls that arrive later.

1. **Stranding.** The thought arrives after call 3 → a pi block at slot 4. Call 4 joins the frame at
   slot 1 → the frame gains a line at slot 1, and slot 4 is already taken.
2. **It reads backwards.** `└ ✓ grep … 42ms` above `Thinking...` says the model grepped before it
   thought.
3. **The collapse only took one thing.** `joinRowGroup` had no notion of a thought, so the only thing
   it could pull in was the command.
4. **The timer double-counted.** `· 12s` spans the commands *and* the idle thought.

## 4. The model that shipped

The frame is still commands only — no thought rows, no thought children, `rowGroupLines` untouched.
What changed is the **boundary**: a thought ends the run of calls that share a frame. The thought
itself stays exactly where pi drew it.

### 4.1 A thought since the newest member makes the next call open a frame

```text
Before the command                    After the command

✓ Running 4 commands (head -40) · 3s   ✓ Running 4 commands (head -40) ctrl+o to expand · 3s
  └ ✓ $ git log … 81ms
  └ ✗ $ ls src/core … 105ms
  └ ✓ $ ls src/core/policy … 3.4s
  └ ✓ $ grep -rn "env" … 42ms
                                        Thinking...
Thinking...
                                        ● Running 1 command · 1s
                                          └ $ npm run typecheck
```

Two lines of change, one rule: the old frame folds to one line, the new command opens its own frame
below the thought. Nothing is ever drawn above a block that arrived later.

### 4.2 The five invariants (all enforced by tests)

**I1 — a frame never spans a thought.** While open it is the last frame on screen; a call that
follows a thought starts a new one. This is what replaces "the frame takes the thought".

**I2 — one paint, one array.** Count, `└` lines and the overflow line all come from `members` in one
`rowGroupLines` call, so `4 commands` can never sit above three command lines.

**I3 — a thought is drawn exactly once, by pi.** Never restyled, never blanked, never a row of ours,
in any state.

**I4 — a thought is not a command.** It never enters the count, never sets the mark, never takes a
`$` line, never restarts a frame's duration.

**I5 — boundaries.** A thought never closes a frame by itself; the *next call* does (§4.1). Assistant
text closes it the moment it starts streaming, not at `turn_end`. A user/steering message, a call of
a different kind, a non-row tool (`write`, `edit`, `codemode`) and the end of the turn close it.

### 4.3 Boundaries as implemented

| Event | Frame |
| --- | --- |
| thought starts while a frame is open | stays open; pi draws the block below it, header takes the `(thinking Ns)` bracket |
| thought finishes | stays open; the block stays below it |
| same-kind call starts, no thought since the newest member | joins the open frame |
| same-kind call starts, a thought came after the newest member, nothing running | **old frame folds, new frame opens** |
| same-kind call starts while a member is still running | joins (a running row must not be folded away) |
| call of a different kind, or a non-row tool | closes / new frame |
| assistant text starts streaming (`message_update`) | closes |
| user or queued (`Steering:` / `Follow-up:`) message | closes |
| `turn_end`, `session_shutdown` | closes / resets |

### 4.4 What the `· 12s` means

Wall clock from the frame's first member to its last activity. `liveEndMilliseconds` keeps it ticking
while something is live — a running command or a streaming thought — and freezes it at the last
settle. A frame that was cut off by a thought therefore stops where its own work stopped, not where
the next step began.

## 5. Event → action, as wired

| pi event / call | Where | Action |
| --- | --- | --- |
| `message_update`, trailing `thinking` | `extensions/tool-view.ts` | `beginThinking()` → `thoughtCount += 1` |
| `message_update`, no trailing `thinking` | same | `endThinking()` |
| `message_update`, a text block | same | `closeRowGroup()` — **new**: the reply closes the frame as it starts streaming |
| `message_start`, role `user` | same | `closeRowGroup()` |
| `turn_end`, message carries text | same | `closeRowGroup()` (safety net) |
| row tool call | `src/tool-view/renderers.ts` | `joinRowGroup` → `groupForCall` |
| — | `src/tool-view/row-groups.ts` | `thoughtCameAfterNewestMember()` compares `thoughtRevision()` with `group.thoughtAtNewestMember`; true and nothing running → `createGroup` (which folds the previous frame) |
| non-row tool | `extensions/tool-view.ts` | `closeRowGroup()` |
| `session_start` / `session_shutdown` | same | reset frames and the thought counter |

Two pieces carry the behaviour: `thoughtRevision()` in `thinking-clock.ts` (a counter bumped by
`beginThinking`, reset by `resetThinking`) and `thoughtAtNewestMember` on each group (stamped in
`createGroup` and `ensureMember`).

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

**Step 5 — the thought finishes and the next command lands.** The frame above folds to one line, the
command opens its own frame below the thought. Nothing sits above a line that came after it:

```text
✓ Running 4 commands (head -40) ctrl+o to expand · 3s

Thinking...

● Running 1 command · 1s
  └ $ npm run typecheck
```

This is the one place the shipped shape differs from the reviewed draft: the draft had one frame of
five rows with the thought nowhere. That needs the thought erased, which §7 shows the host does not
allow. The difference is the thought line and one extra header — and in exchange no row is ever drawn
out of order.

**Step 6 — the answer starts streaming.** Text closes the new frame (I5) and folds it:

```text
✓ Running 4 commands (head -40) ctrl+o to expand · 3s

Thinking...

✓ Running 1 command (npm run typecheck) ctrl+o to expand · 4s

The `.env` was read through the guard, not the sandbox: `read(".env")` matches the L2
ask rule before L1 ever sees a path…
```

**Step 7 — no further command, only the answer.** The thought stays pi's block, the frame folds under
it, nothing is taken:

```text
✓ Running 4 commands (head -40) ctrl+o to expand · 3s

Thinking...

Good — nothing else to check. Here is what I found…
```

## 7. Why the thought cannot be made invisible

Read from the host's own source, not guessed — `dist/modes/interactive/components/assistant-message.js`,
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

Three consequences, each fatal to a different plan:

1. **Default thinking is hidden, and hidden thinking skips markdown entirely.** The
   `registerMarkdownTransformer` hook with `messageType === "assistant-thinking"` only runs in the
   non-hidden branch, so for the default setting it is never called. There is no per-message hook
   for a hidden thought.
2. **Even when it runs, it cannot remove the block.** `addVisibleChild` has already inserted a
   `Spacer(1)`, and the `Markdown` component stays mounted. Returning `""` leaves an empty block and
   a blank line, not zero lines — the opposite of "not visible, no gap".
3. **The one lever that removes the block is global.** `hidden && !this.hiddenThinkingLabel.trim()`
   inside `continue` gives zero lines *and* zero spacing, but `setHiddenThinkingLabel` walks every
   assistant component: it can only show every thought or none, and handing it back re-renders all
   past thoughts at once. That is exactly the fault that made `fc170fc` revert `6def983`.

So "the collapse takes the thinking row and the command row, and the thinking one is not visible" is
not expressible on this host. What is expressible is "the frame never spans a thought", which is what
shipped.

## 8. Alternatives, and why the split won

| Option | Frame shape | Why not |
| --- | --- | --- |
| Blank the thought, draw one frame of N commands | your step 5 | Impossible: §7 |
| Hide all thoughts globally (`setHiddenThinkingLabel("")`) | one frame, no thinking anywhere | Kills `Thinking...` in every other state, including the ones you called fine, and cannot be undone without resurrecting every past thought |
| Re-anchor the frame to its newest call | one frame, always below the thought | Every new call moves the frame down past the thought: rows 1-4 end up *below* a thought that came after them, so the order is still wrong, just inverted |
| **Split at the thought (shipped)** | old frame folded, new frame below | One extra header and the thought stays on screen; every line is in true order |

## 9. Why the earlier attempt was reverted, and what is different

`6def983` shipped records, a bottom `Thinking...` and adoption of a pre-first-call thought;
`fc170fc` reverted it. The reasons still apply, and none of them are reintroduced here:

- no `setHiddenThinkingLabel` anywhere — `tool-view-wiring.mjs` asserts the label is never touched;
- no UI context cached across `/resume`, so nothing can throw inside a renderer;
- no `└ ~ thinking` record, so no thought is ever hidden behind a click;
- a thought is never drawn, counted or labelled by us.

## 10. Tests that now hold the behaviour

| Test | Asserts |
| --- | --- |
| `unit/tool-view-thinking-rows.mjs` | a streaming thought adds no line and rides the bracket; **a command after a thought does not join the row above it**; the row above folds to one line and keeps its own count, command and duration; a thought before the first command opens nothing by itself; a joined command still shares one row |
| `unit/tool-view-live-duration.mjs` | the frame above the thought freezes at its own last settle; the new frame counts from its own command and ends on its own settle |
| `contract/tool-view-wiring.mjs` | streaming text closes the frame before `turn_end`; the next command opens its own frame; the frame above the thought folds; pi's thinking label is still never touched |
| `unit/tool-view-rows.mjs`, `tool-view-registry.mjs` | the pure renderer is unchanged: a thought still never becomes a child line or enters the count |

Full suite: `45/45 test files passed`, `npm run typecheck` clean.

## 11. Docs updated with the code

- `plan/tool-rows-views.md` §5 and rules 7-8: a thought ends the run of calls; the next command opens
  its own row.
- `README.md` (the `(thinking 4s)` paragraph): same sentence, plus why.
- `skills/auto-permission-system/SKILL.md`, `SECURITY.md`: unchanged — policy and layer status did
  not move.

## 12. Left as an option, not shipped

A `/tool-view` sub-option ("hide thoughts completely") could use the global empty label and accept
its one-way nature: no `Thinking...` anywhere while compact, and no way back without resurrecting
every past thought. It buys your step 5 exactly, at the cost of the states you called fine, so it is
not on by default and needs your call.
