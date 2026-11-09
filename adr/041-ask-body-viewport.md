# ADR-041: The ask body is a viewport measured in wrapped rows

**Status:** Accepted

## Context

`AskSelector` (ADR-031) renders a header, a scrollable body, the options, and a
help line. Its viewport decided whether to scroll by comparing the **logical**
line count of the title against `maxBodyLines`:

```ts
} else if (this.bodyLines.length <= this.maxBodyLines) {
	this.addChild(new Text(styledTitle, 0, 0));   // whole title, unbounded
}
```

The pieces it relies on do not count the same unit. `bodyLines` comes from
`title.split("\n")`, while pi's `Text` renders *wrapped* rows at the render
width. A body with three logical lines can be sixty rows wide on screen.

The Advanced Secure evidence prompt (ADR-018, ADR-040) hit this exactly: a
`ps aux | grep node` output collapses into one enormous `Finding  1: …` line.
The body counted as "2 lines", took the fits-the-terminal branch, and rendered a
widget taller than the terminal. pi clips the bottom of an inline component, so
the **options, the help line, and the bottom border were cut off** — the prompt
looked like a message with no choices. The scroll keys were dead too, because
`handleInput` gated on the same logical count, so page-up/down had nothing to
scroll.

## Decision

- **Measure after wrapping.** `layoutBody(width)` wraps the body with pi's own
  `wrapTextWithAnsi` at the render width (tab-normalized like `Text` does) and
  keeps the visual rows. Pre-wrapped rows are re-rendered 1:1 by `Text`, so the
  count and the screen agree.
- **Size to the terminal, not only to `maxBodyLines`.** The viewport is
  `min(maxBodyLines, terminalRows − chrome − 2)`, where chrome is two borders,
  four spacers, the header, the `Default:` footer pair, the help line, and one
  row per option. The extra 2 rows are the scroll indicator plus one row of
  headroom. `maxBodyLines` (default 12) stays the ceiling for tall terminals.
  The terminal height comes from `tui.terminal.rows`, read through an optional
  field so an RPC/headless double can omit it and fall back to `maxBodyLines`.
- **Layout happens in `render(width)`.** The width is only known there, so
  `AskSelector.render` lays the body out before delegating to
  `Container.render`. The constructor primes the layout with
  `tui.terminal.columns` so input arriving before the first frame still works.
- **Scrolling works on what is visible.** Offset, page size
  (`viewport − 1`), clamps, and the indicator are all in visual rows, and the
  indicator reads `[1–12 of 58 rows | PgUp/PgDn · [/] · Shift+↑/↓ · wheel]`.
  The offset is re-clamped on resize, so a grown viewport does not leave a stale
  window. The wheel still scrolls only the body: it never moves the highlight
  (ADR-036).
- **The body is always its own component.** Previously a short body was
  rendered as one `Text` containing header + body; now the header is a fixed
  row and the body is the viewport, which is what makes the sizing uniform. The
  body's own leading blank line preserves the old spacing.

## Consequences

- A wrapped long line can no longer hide the choices: the prompt always fits the
  terminal and shows header, body viewport, options, and help.
- Long bodies scroll with PgUp/PgDn, `[`/`]`, Shift+↑/↓, or the wheel, with a
  visible position indicator.
- A short terminal shows fewer body rows instead of clipping the options.
- The layout is recomputed per frame (cached per width), so a terminal resize
  re-flows immediately.
- `security/tests/unit/ask-selector.mjs` locks the cases: a single long line
  fits and stays scrollable, options/help survive scrolling, a 24-row terminal
  shrinks the viewport, and a missing terminal height falls back to
  `maxBodyLines`.
- Degenerate case: when the terminal is shorter than the fixed chrome (many
  options on a tiny terminal) the widget still overflows, because at least one
  body row is always shown. That needs option-list scrolling, not body sizing.
