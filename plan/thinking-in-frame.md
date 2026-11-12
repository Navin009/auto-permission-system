# Thinking and the frame

**Status: shipped.** `extensions/tool-view.ts`, `src/tool-view/row-groups.ts`,
`src/tool-view/thinking-visibility.ts`, `src/tool-view/thinking-clock.ts`,
`src/tool-view/commands.ts`, plus `security/tests/unit/tool-view-frame-ownership.mjs`,
`tool-view-thinking-regimes.mjs`, `tool-view-thinking-rows.mjs`, `tool-view-live-duration.mjs` and
`security/tests/contract/tool-view-wiring.mjs`, `tool-view-registry.mjs`.

The rule that shipped, in one line: **in compact, a hidden thought is hidden — no line, no gap — and
a row never moves.**

- A row stays anchored at its **first** command and grows downward. No stacking, no jumping, no
  duplicate mounts.
- A thought leaves nothing on screen. Pi's hidden-thinking label is blanked for the session
  (`setHiddenThinkingLabel("")`), so `Thinking...` never appears and no blank line takes its place.
- The row's `(thinking Ns)` bracket is the only trace while a thought streams.
- If pi is set to show thinking, the label cannot hide it. Then a row **ends** at the thought
  (split), because a row may never be drawn above a block that arrived later.

Words used here: **frame** = the block that starts with `✓ Running 8 commands · 40s` and owns the
lines under it (the other docs call it a row or a group).

---

## 1. What you saw, twice

First the rows above a later thought:

```text
✓ Running 4 commands · 12s
  └ ✓ $ git log --oneline -12 && ls 81ms
  └ ✗ $ ls src/core extensions security tests 2>/dev/null 105ms
  └ ✓ $ ls src/core/policy && grep -rn "\.env" … 3.4s
  └ ✓ $ grep -rn "env" sandbox.default.json 42ms

 Thinking...
```

Then, after the frame was moved to its newest command, the thoughts piled up instead:

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

Both are the same underlying fact: a thought is a block that cannot be inside a row, so any row that
spans one has to either grow past it (first trace) or move past it (second trace). The only way to
have a row that neither grows nor moves is to make the thought take no space at all.

## 2. Who paints what

| On screen | Painted by | Anchored at |
| --- | --- | --- |
| your message | pi | its own transcript entry |
| `Thinking...` / the italic thought | pi, from the `thinking` block of the assistant message | its position in the message stream |
| assistant text | pi | its own block |
| `✓ Running 8 commands · 40s` | `RowGroupComponent.render` → `rowGroupLines` | **the first tool call of the frame** |
| `  └ ✓ $ … 81ms` | same component, one line per member | same slot |
| `read` / `write` / `edit` output | pi's own renderers | its own tool call |

## 3. Why a thought had to stop taking space

`assistant-message.js` (the host's own component) renders a thinking run like this:

```js
const hidden = this.thinkingVisibilityOverrides.get(runIndex) ?? this.hideThinkingBlock;
if (hidden && !this.hiddenThinkingLabel.trim()) continue;      // zero lines, zero spacing
const thinkingComponent = hidden
  ? new Text(theme.italic(theme.fg("thinkingText", this.hiddenThinkingLabel)), this.outputPad, 0)
  : markdownBlock("thinking", thinking, () => new Markdown(thinking, ..., {
      transform: createMarkdownTransform("assistant-thinking", ...),
    }));
addVisibleChild(new MouseRegion(thinkingComponent, ...));        // adds Spacer(1) before it
```

Three facts follow, and the design is built on them:

1. **Default thinking is hidden, and hidden thinking is a plain `Text`.** The
   `registerMarkdownTransformer` hook with `messageType === "assistant-thinking"` only runs in the
   non-hidden branch, so for the default setting no markdown hook can touch a thought.
2. **An empty label is the only zero-space state.** With `hiddenThinkingLabel === ""` the run is
   skipped entirely: no label, no blank line, no spacer.
3. **The label is global.** `setHiddenThinkingLabel` walks every assistant component, so it hides all
   hidden thinking or none — and handing it back re-renders every past thought at once.

So compact blanks the label while it is on. That is a deliberate, session-wide display choice: in
compact, hidden thinking is not shown at all.

## 4. The model that shipped

### 4.1 Anchor: first command, and it never moves

`drawsFrame(group, toolCallId)` is true only for `group.members[0]`. Every other member's renderer
returns an empty component, and `invalidateFrame()` repaints the first mount whenever any other
member joins or settles. One mount, one position, height grows downward — exactly like a normal
block that accumulates output.

```text
● Running 4 commands · 1s
  └ … $ git log --oneline -12 && ls
  └ … $ ls src/core extensions security tests 2>/dev/null
  └ … $ ls src/core/policy && grep -rn "\.env" …
  └ … $ grep -rn "env" sandbox.default.json
```

A second message adds a command to the same row, with no visible seam where the thought was:

```text
● Running 5 commands · 1s
  └ ✓ $ git log --oneline -12 && ls 81ms
  └ ✗ $ ls src/core extensions security tests 2>/dev/null 105ms
  └ ✓ $ ls src/core/policy && grep -rn "\.env" … 3.4s
  └ ✓ $ grep -rn "env" sandbox.default.json 42ms
  └ … $ npm run typecheck
```

### 4.2 Invariants

**I1 — a row never moves and never spans a drawn block.** It is anchored at its first command; the
only thing that can sit above it is a block that was already on screen when it opened.

**I2 — one paint, one array.** Count, `└` lines and the overflow line all come from `members` in one
`rowGroupLines` call, so `8 commands` can never sit above seven command lines.

**I3 — a thought is drawn by pi or not at all.** In compact with hidden thinking it takes zero lines
and zero spacing; compact never draws a thinking row, label or record.

**I4 — a thought is not a command.** It never enters the count, never sets the mark, never takes a
`$` line, never restarts a row's duration.

**I5 — boundaries.** Assistant text closes a row the moment it starts streaming (not at `turn_end`);
a user/steering message, a call of a different kind, a non-row tool (`write`, `edit`, `codemode`) and
the end of the turn close it. A thought closes it only in the visible-thinking regime (§4.4).

### 4.3 Boundaries as implemented

| Event | Frame |
| --- | --- |
| thought starts while a row is open | stays open; header takes the `(thinking Ns)` bracket; nothing else changes |
| thought finishes | stays open; the bracket goes |
| same-kind call starts | joins; the first mount repaints with one more line |
| thinking is **visible** in pi's settings, and a thought came since the last command | **row closes, new row opens** — nothing can hide that block, so no row may span it |
| thinking is visible and a command is still running | joins anyway — a running row must not be folded away |
| call of a different kind, or a non-row tool | closes / new row |
| assistant text starts streaming (`message_update`) | closes |
| user or queued (`Steering:` / `Follow-up:`) message | closes |
| `turn_end`, `session_shutdown` | closes / resets |

### 4.4 How compact knows which regime it is in

The label blanking only removes thoughts pi was hiding. If the user set thinking to visible, the
blocks render as italic markdown — and then our own `registerMarkdownTransformer` is called with
`messageType === "assistant-thinking"`. That call is the probe: it flips `thoughtsRenderAsBlocks()`
to true, and from then on `splitsAfterThought()` ends a row before a thought instead of spanning it.
The transformer returns the markdown untouched.

So there are two regimes and the code picks one at runtime:

| pi setting | compact draws | row |
| --- | --- | --- |
| thinking hidden (default) | nothing for a thought | one row per run, anchored at its first command |
| thinking visible | pi's italic block | one row per message group, the row above folds |

### 4.5 What the duration means

Wall clock from the row's first command to its last activity. It keeps ticking while something is
live — a running command or a streaming thought — and freezes at the last settle.

## 5. Event → action, as wired

| pi event / call | Where | Action |
| --- | --- | --- |
| `session_start` | `extensions/tool-view.ts` | `resetRowGroups`, `resetThinking`, `resetThinkingVisibility`, reload the view, then `applyThinkingVisibility(view, ctx.ui)` |
| `message_update`, trailing `thinking` | same | `beginThinking()` |
| `message_update`, no trailing `thinking` | same | `endThinking()` |
| `message_update`, a text block | same | `closeRowGroup()` |
| `message_start`, role `user` | same | `closeRowGroup()` |
| `turn_end`, message carries text | same | `closeRowGroup()` (safety net) |
| row tool call | `src/tool-view/renderers.ts` | `joinRowGroup` then `rowComponent`, gated by `drawsFrame` |
| markdown for `assistant-thinking` | `extensions/tool-view.ts` | `noteThinkingRendered()`, return the markdown unchanged |
| `/tool-view …` | `src/tool-view/commands.ts` | save the mode, `setActiveViewMode`, `applyThinkingVisibility(mode, ctx.ui)`, close or reset rows |
| non-row tool | `extensions/tool-view.ts` | `closeRowGroup()` |
| `session_shutdown` | same | reset rows, clock and the visibility probe |

`applyThinkingVisibility` writes `""` for compact and `undefined` (pi's default) for full, once per
session start or mode switch, and swallows a failed write so a display-only extension can never take
the session down.

## 6. The reported turn, after the change

**Step 1 — your message, the thought streams.** Nothing on screen for the thought: no label, no gap.
The working spinner is pi's.

**Step 2 — four parallel commands start.** One row, anchored at the first command:

```text
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

**Step 4 — a second thought streams.** The row does not move, nothing is added below it, and the
bracket is the whole trace:

```text
✓ Running 4 commands (thinking 2s) · 5s
  └ ✓ $ git log --oneline -12 && ls 81ms
  └ ✗ $ ls src/core extensions security tests 2>/dev/null 105ms
  └ ✓ $ ls src/core/policy && grep -rn "\.env" … 3.4s
  └ ✓ $ grep -rn "env" sandbox.default.json 42ms
```

**Step 5 — the thought finishes, the next command lands.** Still one row, one line more, no seam:

```text
● Running 5 commands · 1s
  └ ✓ $ git log --oneline -12 && ls 81ms
  └ ✗ $ ls src/core extensions security tests 2>/dev/null 105ms
  └ ✓ $ ls src/core/policy && grep -rn "\.env" … 3.4s
  └ ✓ $ grep -rn "env" sandbox.default.json 42ms
  └ … $ npm run typecheck
```

**Step 6 — the answer starts streaming.** Text closes the row and folds it:

```text
✓ Running 5 commands (npm run typecheck) ctrl+o to expand · 8s

The `.env` was read through the guard, not the sandbox: `read(".env")` matches the L2
ask rule before L1 ever sees a path…
```

**Step 7 — a turn that ends on a thought.** The row folds as usual and the thought is still invisible:

```text
✓ Running 4 commands (head -40) ctrl+o to expand · 3s

Good — nothing else to check. Here is what I found…
```

The same transcript with pi's thinking set to **visible** keeps every block but splits the row, so
nothing is drawn above a block that arrived later (§4.3).

## 7. What this costs

- **The thought's text is not readable in compact.** It is hidden, not blanked per message, so there
  is nothing to click. Switching to `/tool-view full` restores pi's label and every past thought
  re-appears (the transcript reflows once, on an explicit switch).
- **A turn with only thinking and no tool calls shows nothing** in compact. Pi's working indicator is
  still there while it streams; the reasoning is not.
- **Visible-thinking users get the split** (§4.4), which means two headers for a run interrupted by a
  thought. That is the honest option there: a row may not span a block it cannot hide.

## 8. Alternatives, and why they lost

| Option | Shape | Why not |
| --- | --- | --- |
| Anchor at the first command, leave thoughts visible | rows above a later thought | The first trace in §1 |
| Anchor at the newest command | one row, thoughts stacked above it | The second trace in §1 |
| Split at the thought | two rows per run | Interleaved and correct, but two headers for one run |
| Per-message blanking via the markdown hook | one row, one thought row hidden | Impossible: hidden thinking never reaches the hook, and the component keeps its spacer (§3) |
| **Anchor at the first command, blank the label for compact (shipped)** | one row, no thought lines | The thought is not readable in compact; everything else is exact |

## 9. Why the older attempt was reverted, and what is different

`6def983` blanked the same global label but *drew* its own `Thinking...` rows and handed the label
back at turn end, so past thoughts re-appeared and a tool-free turn showed nothing. Here:

- the label is written once per session start and per explicit mode switch, never per turn, so no
  transcript churn mid-conversation;
- compact draws **no** thinking row, label or record, so there is nothing to double up or fold away;
- the write goes through the live `ctx.ui` and is wrapped, so a stale context cannot crash the
  session (the `fc170fc` failure).

## 10. Tests that hold the behaviour

| Test | Asserts |
| --- | --- |
| `unit/tool-view-frame-ownership.mjs` | the first command owns the mount; a join repaints that mount and never draws; later members never draw; closing repaints each member once; a four-command run has one drawer repainted once per join |
| `unit/tool-view-thinking-regimes.mjs` | a hidden thought keeps one row; a rendered thought starts a new one and folds the row above; a running command is never folded away |
| `unit/tool-view-thinking-rows.mjs` | a streaming thought adds no line and rides the bracket; a command after a thought joins the row; the thought is never a row, never counted |
| `unit/tool-view-live-duration.mjs` | the row keeps counting across a thought and ends on the last settle |
| `contract/tool-view-wiring.mjs` | a session start applies the saved label, compact writes `""`, full restores `undefined`, a second switch or a render/close/reset writes nothing; text closes a row at stream start; a hidden thought never splits a row |
| `contract/tool-view-registry.mjs` | the first call draws, later calls render empty, and the drawer shows every member |

Full suite: `47/47 test files passed`, `npm run typecheck` clean.

## 11. Docs updated with the code

- `plan/tool-rows-views.md` §5 and rule 8: in compact a hidden thought leaves no line and the row
  never moves; a visible thought ends the row.
- `README.md` (the `(thinking 4s)` paragraph): the same rule, plus the visible-thinking exception.
- `skills/auto-permission-system/SKILL.md`, `SECURITY.md`: unchanged — policy and layer status did
  not move.

## 12. Not in scope

- Reading a thought in compact. It is hidden; `/tool-view full` is the way to see it.
- Rows for `edit` / `write` / `codemode` (they close the row, as today).
- Restoring thoughts when a session resumes: the label is applied again on `session_start`, so a
  resumed compact session hides them too.
