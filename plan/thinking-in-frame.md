# Hidden thinking takes no space, and every call keeps its own slot

**Status: shipped.** `src/tool-view/thinking-visibility.ts` (Pi's label API),
`src/tool-view/row-groups.ts` (`memberIndexOf`), `src/core/tool-view/row-group.ts`
(`rowGroupLinesForMember`), `src/tool-view/row-group-component.ts`, `src/tool-view/renderers.ts`, plus
`security/tests/unit/tool-view-thinking-visibility.mjs`, `tool-view-frame-ownership.mjs` and the
label assertions in `security/tests/contract/tool-view-wiring.mjs`. Supersedes `549d55b` (row ends at
a thought), `963134e` (suppress a thought and keep a private copy) and `1f616e5` (leave thinking
visible between the run's lines).
`plan/tool-rows-views.md` §5 and rules 7-8 follow it.

Two rules, and they solve the problem together:

1. **In `compact`, a hidden thought takes no space at all.** Pi's hidden-thinking label is blanked
   for the session, so its whole run is skipped: no `Thinking...`, no spacer, no gap.
2. **A run is drawn by its slots.** The header is drawn once at the first call; every later call
   draws only its own `└` line, in its own transcript position. So even when Pi does render a
   thought — user setting "show thinking" — no command line can end up above it.

While a thought streams, the only signal we add is the `(thinking Ns)` bracket, and the row's timer
keeps counting. `full` restores Pi's label, so thinking is readable there.

Words used here: **run** (or group/row) = the block that starts with
`✓ Running 8 commands · 40s` and owns the `└` lines for a stretch of consecutive calls.

---

## 1. Why one slot was not enough, and hiding alone was not enough either

A row used to be drawn by one mount: the first call's renderer emitted the header *and* every
member's line. A thought is a separate transcript child at its own position, so any command that
joined after it had its line painted above Pi's block. The attempts and their costs:

| Attempt | What it did | Why it failed |
| --- | --- | --- |
| end the run at the thought (`549d55b`) | new group after each thought | several `Running N commands` headers per run |
| mount at the newest call (`c7d6898`) | run sinks below the thought | thoughts pile up above the row |
| draw our own thought line (`8e2d824`, `5eb698e`) | `Thinking...` inside the row | Pi's block, click and text are lost |
| patch the host component (`963134e`) | suppress one block privately | the CLI is a bundled build, so the patched class is not the one on screen |
| leave thinking in place (`1f616e5`) | one header, per-slot drawing | correct order, but the thought still takes lines in `compact` |

Hiding through **Pi's own label API** is different from patching a class: `setHiddenThinkingLabel` is
part of the extension UI context, so it reaches the running components whatever build they come
from. That is the lever this design uses, together with per-slot drawing for the case where a
thought is actually rendered.

## 2. The shipped behaviour

**A hidden thought between commands** — nothing on screen, one header, the run continues:

```text
● Running 3 commands (thinking 2s) · 8s
  └ ✓ $ head -150 plan/tool-rows-views.md 900ms
  └ ✓ $ sed -n '1,40p' src/tool-view/renderers.ts 800ms
  └ … $ npm test
```

**While it streams** — the bracket borrows the target slot and the timer keeps running; when the
thought completes the bracket leaves and nothing else moves.

**Expanded to Pi's view** — the call's own thinking comes back, natively: a real
`AssistantMessageComponent` built from that message's thinking blocks is placed above the call's Pi
block, so it reads as Pi draws it and its click collapses it to `Thinking...`.

```text
  I should read the plan doc before changing the renderer.

bash
  head -150 plan/tool-rows-views.md
──────────────────────────────────────────
<file contents>
```

The thought is captured from the message that produced the call — live from `message_update` /
`message_end`, and on a resumed session from `sessionManager.getBranch()` — and attached by the
call's `toolCall` id. It is never drawn at the row or group level.

**Thinking set to visible in Pi** — the italic block renders, and the run still reads in order,
because each call draws its own line:

```text
✓ Running 2 commands · 6s
  └ ✓ $ head -150 plan/tool-rows-views.md 900ms

  I should read the plan doc next.

  └ … $ npm test
```

**`full`** — Pi's label is restored, so a thought reads exactly as Pi renders it. Switching modes
writes the label once per switch; nothing else about the transcript changes.

**A resumed session** — the mode is read from settings on `session_start` and the label is applied
again, because Pi rebuilds its components with the default label. No in-memory thought state exists,
so grouping is identical to the live session.

## 3. The model

```text
RowGroup
  members: RowMember[]        one slot per call, in join order
  expansionLevel              Row | Group | Collapsed | Full
```

`memberIndexOf(group, toolCallId)` tells a renderer which slot it owns and
`rowGroupLinesForMember()` returns that slot's lines: member 0 draws the header plus its own line,
member n draws its line, a folded group draws the header alone.

`thinking-visibility.ts` owns one value:

| Mode | Label written | Effect |
| --- | --- | --- |
| `compact` | `""` | Pi skips the hidden run whole — zero lines, zero spacing |
| `full` | `undefined` | Pi's default label (`Thinking...`) comes back |

It is applied on `session_start` and on every explicit mode switch, never on render, and it is
idempotent within a mode so a repaint cannot trigger a relabel loop.

`thought-store.ts` remembers, per `toolCall` id, the assistant message that carried it, reduced to
its thinking blocks; `native-thought.ts` turns that into a visible Pi component. Only the expanded
levels ask for it, so the thought exists exactly where it is wanted.

## 4. What this costs

- **A thought is not readable in `compact`.** Switch to `full` — or set Pi to show thinking, which
  the label cannot hide; the run then keeps its order thanks to per-slot drawing.
- **The expanded thought uses the default theme.** The component is built by the extension, so it
  goes through the extension's own theme module: custom themes and live theme switches do not reach
  it. Everything else (markdown, italics, the click, spacing) is Pi's.
- **A thinking-only turn shows nothing in `compact`.** No rows and no block; the bracket is the only
  trace while it streams.
- **The label is session-wide.** It hides every hidden thought, which is exactly the intent here: in
  `compact`, hidden thinking is simply not part of the transcript.

## 5. Tests

| Test | Asserts |
| --- | --- |
| `unit/tool-view-thinking-visibility.mjs` | compact writes `""`, full writes `undefined`, repeats are no-ops, reset re-applies, a missing ui or a failed write is harmless and retried |
| `unit/tool-view-native-thoughts.mjs` | a message's thinking is stored against its `toolCall` id, only thinking blocks are kept, the row draws nothing, the expanded level draws Pi's thought above the call block and keeps Pi's own call and result |
| `unit/tool-view-frame-ownership.mjs` | member 0 owns the header, later members own their own slots, joining repaints the header only, closing repaints every member once |
| `unit/tool-view-thinking-rows.mjs` | a thought never becomes a `└` line or a count, and a later command keeps the same run |
| `unit/tool-view-live-duration.mjs` | the header counts across a thought and settles on the newest command |
| `contract/tool-view-wiring.mjs` | the label is written on session start and on each switch, never on render, close or reset |
| `contract/tool-view-registry.mjs` | a joining read or command draws only its own line and carries no header |
