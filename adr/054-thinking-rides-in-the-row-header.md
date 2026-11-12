# ADR-054: A running thought is a pair of parens in the open row's header

**Status:** Accepted — replaces R19's `~ Thought for <Ns>` line.

## Context

R19 asked for thinking as a line of its own — `~ Thought for <Ns> — click to read` — and said it is
never part of a group and ends the group above it. On a command-heavy turn that reads as a separate
block between two rows, and it deliberately split a group in two every time the model paused to
think, so the count a user cares about (`Running 3 commands`) could never be reached.

Pi already owns the visible thinking block: `AssistantMessageComponent` draws either the italic
Markdown or, with `hideThinkingBlock`, a single `Thinking...` label. We cannot nest that component
inside a row — it is not a renderer slot — but the stream does tell us when a thought starts and
stops: `message_update` carries `assistantMessageEvent.type` of `thinking_start`, `thinking_delta`,
`thinking_end`, then `text_start` / `toolcall_start`.

## Decision

1. **The thought rides in the header, in parens, before the duration.**
   `Running <N> commands (thinking… <Ns>) · <total>` — `headerBody` in
   `src/core/tool-view/command-group.ts` composes `count`, `thinking` and `duration` as separate
   fields, so each segment can be dropped on its own.
2. **The counter ticks once a second while the thought runs.** `thinkingPart` in
   `src/core/tool-view/thinking.ts` is pure: it turns `{ startedAt, now }` into `thinking… 3s`. The
   store in `src/tool-view/thinking.ts` owns `startedAt`, a 1s ticker and a repaint hook; a second
   `thinking_start`/`thinking_delta` never restarts the clock.
3. **The parens disappear when the thought ends.** No `thought 3s` afterwards, no history line: the
   header returns to `Running <N> commands · <total>` byte for byte.
4. **Thinking never becomes a group member.** It is not counted in `<N>`, it adds no `└` line, and
   it no longer closes the group — `message_update` handlers in `extensions/tool-view.ts` only
   start and stop the clock.
5. **Only the open group shows it.** `groupSummary` passes the state through only when the rendered
   group is `currentGroup`, so a thought cannot light up a row that has already been closed by an
   assistant reply or another tool.
6. **Width drops the least important segment first.** The component tries hint → thinking →
   duration, and `● Running <N> commands` always survives (C7 truncation stays the last resort).
7. **A running thought keeps the mark open.** `groupStatus` reads a thought as `Running`, so a group
   whose commands have all settled still shows `●` while the model thinks; `✗`, `✗ blocked` and
   `✗ denied` still outrank it.

## Consequences

- A turn that thinks and then runs three commands is one `Running 3 commands (thinking… 2s)` row
  instead of a thought line splitting the group into two rows.
- Nobody can click back to the thought text from the row: R19's `— click to read` is gone with the
  line. Pi's own thinking block is still what shows a thought, in `full` and in every expanded
  level, untouched (R22).
- Pi's own `Thinking...` label is still drawn above the row while a thought runs, so the same
  moment is reported twice. Suppressing it means `ui.setHiddenThinkingLabel("")` while the level is
  `Row` and restoring it on expand; that is a separate decision with its own visibility trade-off,
  so it is not taken here.
- Display only: no session writes, no timers past the end of the thought (`unref`ed, stopped on
  `thinking_end`, `message_end`, `session_shutdown`), and both security layers see the same calls.
