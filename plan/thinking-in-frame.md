# One group per run, Pi's thinking stays in place

**Status: shipped.** `src/core/tool-view/row-group.ts` (`rowGroupLinesForMember`),
`src/tool-view/row-group-component.ts`, `src/tool-view/row-groups.ts` (`memberIndexOf`),
`src/tool-view/renderers.ts`, plus `security/tests/unit/tool-view-frame-ownership.mjs` and
`tool-view-thinking-rows.mjs`. Supersedes `549d55b` (row ends at a thought) and `963134e`
(suppress a thought and keep a private copy for expansion).
`plan/tool-rows-views.md` §5 and rules 7-8 follow it.

The rule, in one line: **the header is drawn once at the first call of a run, every later call
draws its own line in its own transcript slot, so Pi's thinking can never split the run and never
has to be hidden or copied.**

- A thought between two commands does not open a new group.
- Nothing of ours draws, hides, relabels or copies a thought. Pi's block stays where Pi put it,
  with Pi's own label, text, click and spacing.
- A thought is never a `└` line and is never counted.
- No in-memory thought tracking exists, so a resumed session renders the same as the live one.

Words used here: **run** (or group/row) = the block that starts with
`✓ Running 8 commands · 40s` and owns the `└` lines for a stretch of consecutive calls.

---

## 1. Why a single drawing slot could not work

A row used to be drawn entirely by one mount: the first call's renderer emitted the header *and*
every member's `└` line. That is fine while nothing sits between the calls, but a thought is a
separate transcript child at its own position:

```text
[call c1 slot]      ← the row drew ALL lines here
[Pi thinking block] ← different child, own position
[call c2 slot]      ← empty, because c1 draws everything
```

Any command that joined after the thought had its line painted **above** the thought. Every earlier
attempt picked one cost of that fact:

| Attempt | What it did | Why it failed |
| --- | --- | --- |
| end the row at the thought (`549d55b`) | new group after the thought | several `Running N commands` headers per run |
| mount at the newest call (`c7d6898`) | row sinks below the thought | thoughts pile up above the row |
| hide the thought (`399bc61`, `963134e`) | suppress that block | needs Pi internals; the running CLI is a bundled build, so an extension cannot reach the live class |
| draw our own thought line (`8e2d824`, `5eb698e`) | `Thinking...` inside the row | Pi's own block, click and text are lost |

## 2. The model that shipped

```text
RowGroup
  members: RowMember[]        one slot per call, in join order
  expansionLevel              Row | Group | Collapsed | Full
```

`memberIndexOf(group, toolCallId)` tells a renderer which slot it owns, and
`rowGroupLinesForMember()` returns the lines for that slot:

| Slot | Draws |
| --- | --- |
| member 0 | the header, plus its own `└` line |
| member n | its own `└` line only |
| any member, folded group | nothing except member 0's one-line header |

So the transcript order is the drawing order, whatever sits in between:

```text
● Running 4 commands (thinking 2s) · 8s
  └ ✓ $ head -150 plan/tool-rows-views.md 900ms
  └ ✓ $ sed -n '1,40p' src/tool-view/renderers.ts 800ms

 Thinking...

  └ … $ sed -n '1,120p' plan/tool-rows-views.md
  └ … $ npm test 2s
```

## 3. Folding, expanding, replaying

**Folded** (a later call started): only member 0 draws, so the run is one line. The thoughts stay
exactly where Pi drew them, below it.

```text
✓ Running 4 commands (npm test) ctrl+o to expand · 12s

 Thinking...
```

**Expanded to the group**: every member draws its `└` line again, in its own slot, so the list
reappears around the thought.

**Expanded to Pi's view**: each member already draws its own Pi call/result block, so the native
view is simply Pi's output for that call, in order, with the thought between.

**Resumed session**: nothing depends on live events or in-memory state. Booleans, groups and
reasoning are rebuilt from the calls as Pi renders them, so a resumed run looks like the live one.
This replaces the earlier replay problem, where the thought counters only moved on live
`message_update` events and a resumed transcript collapsed into one group at the top.

## 4. What this costs

- **A thought is visible at group level.** Removing Pi's lines for one thought needs a per-run
  visibility API in Pi (`setThinkingRunVisible(messageId, runIndex, false)`); the extension cannot
  reach the bundled `AssistantMessageComponent`. So a thought stays inline instead of being
  absorbed into the collapsed row.
- **The header sits at the top of the run.** After many post-thought commands, the header can
  scroll out of view while continuation lines are still on screen.
- **A folded run and its thoughts are not one line.** The row folds to one line; Pi's blocks below
  it are Pi's and are untouched.

## 5. Tests

| Test | Asserts |
| --- | --- |
| `unit/tool-view-frame-ownership.mjs` | member 0 owns the header, later members own their own slots, joining repaints the header only, closing repaints every member once |
| `unit/tool-view-thinking-rows.mjs` | a thought never splits a shell or read run, no thought becomes a `└` line or a count, the member slot draws only its own command, the bracket still rides the header |
| `unit/tool-view-live-duration.mjs` | the header counts across a thought and settles on the newest command |
| `contract/tool-view-registry.mjs` | a joining read or command draws only its own line and carries no header |
| `contract/tool-view-wiring.mjs` | a command after a streamed thought stays in the same run; text and other boundaries still close it |
