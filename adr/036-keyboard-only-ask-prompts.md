# ADR-036: Ask prompts are keyboard-only; mouse events cannot pick an answer

**Status:** Accepted
**Amends:** ADR-031 (TUI selector)

## Context

The TUI ask selector (`src/ui/ask-selector.ts`) hosts pi's `SelectList` for the
answer rows. `SelectList.handleMouse` is not decorative:

- a left **click** on a row fires `onSelect` immediately — one click, no
  confirmation step (`select-list.js`, `event.type === "click"`);
- the **wheel** moves `selectedIndex` (`wheelDelta`).

The selector sits in pi's editor slot, and `Container.handleMouse` hit-tests
the whole prompt box and forwards the event to the row under the cursor. On
2026-10-11 this produced a plausible accidental allow: the audit recorded
`yes` ("once") for `~/.pi/agent/mcp.json` at 18:20:10Z, 6.8 s after the read
tool call — well inside the 15 s countdown, so the timer did not decide it —
while the user reports never picking the row. A click or wheel over the prompt
can move the highlight to `Yes, just this once` and hide the `Default: No`
footer; the next Enter then allows the call.

An ask prompt is the one place where a stray input must never mean yes: the
window between "read these options" and "answer" is exactly when a user is
moving the mouse.

## Decision

`AskSelector.handleMouse()` returns `undefined` without calling the inherited
`Container.handleMouse`, so mouse events are never dispatched to the
`SelectList`.

- Clicks (press / click / release) and wheel over the prompt change nothing
  and settle nothing; only ↑/↓/Enter/Esc act.
- Returning `undefined` rather than claiming `handled` leaves the renderer's
  screen-level text selection working over the prompt rows — that gesture
  cannot pick an answer.
- Keyboard behavior is unchanged: the highlight clamps at the ends, Enter
  returns the highlighted label, Esc cancels, and countdown semantics stay as
  in ADR-024 / ADR-031.

## Consequences

- Regression tests in `unit/ask-selector.mjs`: a click on the
  `Yes, just this once` row, wheel events, and a press/release/click sequence
  must not settle the prompt, must not move the highlight, and must not hide
  the footer; Enter after each still picks the keyboard-highlighted row
  (`PASS=34`).
- Mouse selection remains available everywhere else in pi; the restriction
  applies only while an ask prompt is on screen.
- If pi-tui later offers a keyboard-only flag on `SelectList`, this shim can be
  replaced by that flag.
