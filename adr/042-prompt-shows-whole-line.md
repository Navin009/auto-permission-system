# ADR-042: The prompt shows the whole detected line and scrolls it

**Status:** Accepted

Supersedes the row windowing and row cap of ADR-040.

## Context

ADR-040 fixed a real usability failure: a `ps aux | grep node` evidence row is
~5,500 characters, and dumping it pushed the question and its choices off
screen. The fix was to window each row to ~160 characters around the matched
value, cap the list at 10 rows, and report the rest as
`Hidden   N more detected line(s) not shown`.

ADR-041 then removed the cause of that failure at the source. The selector
measures the body in **wrapped rows** and sizes the viewport to the terminal, so
a body that is longer than the screen scrolls instead of growing. With that in
place the windowing is no longer load-bearing, and it costs the user something
they asked for: the point of the prompt is to show *what* was found, and a
5,500-character command is exactly the case where the reviewer wants to read
the whole thing (which proxy credentials, which mounts, which jar) before
answering.

Windowing also hid information in a subtle way: a narrow window shows the first
matching value but not the other four on the same line, so "show it this once"
and "keep it hidden" could be decided on partial evidence.

## Decision

- **Evidence rows are complete.** One `Finding  <lineNo>: <line>` row per
  detected line, with the full line, however long. No clipping, no ellipsis, no
  row cap, no `Hidden   …` remainder row.
- **The viewport does the bounding.** The body scrolls (PgUp/PgDn, `[`/`]`,
  Shift+↑/↓, wheel) with a `[1–12 of 34 rows]` indicator, while the header, the
  question, the choices and the help line stay on screen (ADR-041). A 5,500-char
  line becomes ~34 wrapped rows and is read by scrolling.
- **The row still shows the raw text**, not the redacted copy: the user being
  asked is the trusted party, and the point of the prompt is to recognise what
  was found.
- **The fallback stays.** A hit no line-level diff can locate (whole-content
  detector, or a PEM block whose redaction removed lines) still renders as the
  finding label plus the scanner's own preview, so the prompt never appears
  with no evidence.
- **Lesson applied to the pair of fixes.** Windowing and a terminal-sized
  viewport solve the same problem, and doing both is what produced a prompt
  that was bounded *and* unreadable. The compositor now owns the bounding; the
  gate owns only the content.

## Consequences

- The user can read the entire matched line and decide on complete evidence.
- Prompt height is bounded by the viewport, not by how much output matched, so a
  file with hundreds of secret-shaped lines is still scrollable rather than
  truncated.
- Very long prompts mean the reviewer may need to scroll several pages. That is
  the trade the user asked for, and the indicator makes the amount obvious.
- `security/tests/unit/exposure.mjs` locks the new contract: one complete row
  per detected line, no ellipsis, no dropped rows (`40` detected lines → `40`
  rows), and `unit/ask-selector.mjs` keeps the scrolling behaviour.
