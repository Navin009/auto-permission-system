# ADR-053: A click walks the row through Pi's collapsed block, then the full one

**Status:** Accepted — supersedes ADR-051's "one boolean" limitation.

## Context

ADR-051 made `ctrl+o` draw Pi's own block for every command of a group, and recorded the limit:

> Multi-level drill-down (group row → Pi's collapsed block → Pi's own expanded block) is still not
> reachable through `context.expanded`, which is one boolean. A third level needs a click handler of
> our own plus a decision recorded in its own ADR.

Pi's boolean is one bit, toggled by `ctrl+o` and by a click on either of its `MouseRegion`s
(`ToolExecutionComponent.createResultRegion`). It cannot express three states, and reaching the
collapsed block matters: it is the only view that shows the start of a long output next to the row
without pushing the rest of the transcript away.

`MouseRegion` dispatches to its child first and only falls back to its own handler when the child
returns nothing (`pi-tui/dist/components/mouse-region.js`), so a component of ours can take the click
before Pi toggles its bit.

## Decision

1. **The group owns the level, not the render context.** `CommandGroup` carries
   `expansionLevel: ExpansionLevel` — `Row`, `Collapsed`, `Full` — in
   `src/tool-view/command-groups.ts`; the cycle is the pure `nextExpansionLevel` in
   `src/core/tool-view/expansion-level.ts`.
2. **A click advances one level and is consumed.** `CommandGroupComponent` (the row) and
   `PiBlockComponent` (Pi's block) answer a left click with `{ handled: true }` and call
   `advanceGroupExpansion`, which advances the level and invalidates every member of the group. Pi's
   `MouseRegion` therefore never toggles its own boolean for a click on our row.
3. **The level drives Pi's slots.** `Collapsed` calls Pi's `renderResult` with `expanded: false`,
   `Full` with `expanded: true`, and `renderCall`'s context gets the matching `expanded`. The
   renderers are still called, never copied.
4. **`ctrl+o` keeps its meaning.** Pi's boolean, when set, resolves to `Full` regardless of the
   clicked level, so the key still opens the whole group in one step and closes it again.
5. **The row is level `Row`.** Only our own `CommandGroupComponent` draws there, so a third click
   puts the list back exactly as ADR-050 drew it.

## Consequences

- One row, then Pi's collapsed block per command (command line plus output preview), then Pi's full
  block per command, then the row again.
- Every member is invalidated when the level changes, so a group of several commands moves together
  instead of one block at a time.
- A click at any level is consumed by us, so Pi's own per-call expand stays off and the level stays
  authoritative; only `ctrl+o` writes pi's boolean.
- The behaviour is a display decision only: no session writes, no extra timers, and the two
  security layers see the same calls in every level.
- Clicking a `└` line to open one command alone is still not possible: the row is one component, so
  the click is the whole row (R14 stays open).
