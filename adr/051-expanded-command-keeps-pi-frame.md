# ADR-051: An expanded command keeps Pi's frame, not a flush-left imitation

**Status:** Accepted — supersedes the "flush-left" consequence of ADR-050.

## Context

ADR-050 §3 chose `renderShell: "self"` so a suppressed call draws no lines and the group row is
flush-left. That declaration also removes Pi's default `Box` — the one-column indent and the
`toolSuccessBg` / `toolErrorBg` / `toolPendingBg` seal — from the whole row. Expansion inherited the
loss: `docs/TOOL_ROWS_VIEWS.md` §5 promises the expanded view is "Pi's output, byte for byte", but
what shipped was Pi's slot renderers drawn with no frame at all, so the block looked nothing like
the same command in `full`.

Two further facts about the API make the frame reproducible without giving up suppression:

- Each slot's renderer receives `context.outputPad` and `context.isPartial` / `isError`, which are
  exactly the inputs `ToolExecutionComponent` feeds its `Box` and background function.
- Pi calls the result slot after the call slot in every display update, so the call slot's
  component can own the box and the result slot can append to it, in that order, every time.

## Decision

1. **`compact` adds a layer; it does not restyle Pi.** Whatever is not the group row is Pi's own
   component inside Pi's own frame. Expansion therefore hands back exactly what `full` draws.
2. **One box per row, owned by the call slot.** `src/tool-view/pi-block.ts` holds a `Box` built with
   `outputPad`, no vertical padding of its own, and a `BlankLine` above and below the content. The
   box renders `[padding, Pi call slot, Pi result slot, padding]`, which is the same line sequence
   as Pi's `Spacer(1)` + `Box(paddingX, 1, bg)` composition.
3. **The built-in renderers are delegated to, never copied.** The call slot calls
   `next().renderCall`, the result slot calls `next().renderResult`, each with
   `lastComponent` pointing at the slot's own previous component so Pi's in-place updates keep
   working. Our component is never handed to them, which is what previously made Pi's
   `setText` / `addChild` calls throw and fall back to raw text.
4. **The result slot draws no lines of its own.** It appends its component to the call slot's box and
   returns an empty `Text`, so a row is one box rather than two stacked frames and the group's
   "no lines, no space" suppression still holds for rows that draw nothing.
5. **The background follows Pi's state machine.** `isPartial` → `toolPendingBg`, `isError` →
   `toolErrorBg`, settled → `toolSuccessBg`, exactly as `ToolExecutionComponent` picks it.

## Consequences

- `full` is untouched (`full` never reaches this code), and `compact`'s expanded rows are now
  visually identical to Pi's blocks: same indent, same background, same blank lines, same hints.
- A row is drawn by a component composed at call-slot time, so collapsing back to the group row
  discards the box on the next display update. Nothing is cached across expansions.
- Reading Pi's box layout is now a copied assumption (leading and trailing background line, one
  content line per slot line). A Pi upgrade that changes the frame leaves our frame looking stale,
  but never hides output: the worst case is padding that no longer matches.
- Multi-level drill-down (group row → Pi's collapsed block → Pi's own expanded block) is still not
  reachable through `context.expanded`, which is one boolean. A third level needs a click handler
  of our own plus a decision recorded in its own ADR.
