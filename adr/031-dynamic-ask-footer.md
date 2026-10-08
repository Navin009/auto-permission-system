# ADR-031: The ask footer shows a live countdown and drops it on first navigation

**Status:** Accepted

## Context

Every ask-tier prompt ends with a `Default: …` line that says what an
unanswered prompt (and Esc) does. pi's `ui.select` takes the whole prompt as
one static title string, so the line rendered as ordinary title text. Two
things were wrong with that:

- There was no countdown (`(15s)`) even though the prompt already times out
  after `ASK_TIMEOUT_MS` (15s), so an unanswered prompt disappeared without
  the screen ever saying when.
- The line stayed on screen after the user had started moving the selection,
  where it competes with the choice the user is about to make.

pi's built-in selector constrains the fix:

- `ui.select`'s `timeout` option does paint a live `(Ns)` countdown, but it
  appends it to the *last title line* and never toggles anything on
  navigation.
- Re-issuing `ui.select` with a trimmed title on the first arrow key (the
  v3.5.6 attempt) flickers and resets the highlighted row, because every
  call rebuilds the selector.
- `ctx.ui.custom` can host an extension component in the TUI, and pi-tui's
  `Container`/`Text`/`SelectList` pieces provide the same selection,
  wrapping, and width handling as the built-in selector. RPC's `ui.custom`
  is a no-op that resolves `undefined` immediately, so it cannot be used
  there.

## Decision

- `src/ui/ask-selector.ts` renders the ask prompt as a pi-tui custom
  component: title, a separate `Default: … (Ns)` footer with a per-second
  countdown, the option rows (`→` / two-space prefix), the key hints, and the
  usual borders.
- The footer is dropped the first time the selection moves (↑/↓ or mouse)
  **and the countdown restarts**, so reading the options never runs the
  prompt out (v3.5.3 behavior stays). The hint is only shown for an
  untouched prompt.
- Expiry calls `onExpire()` and then resolves `undefined`; `askSelect`
  records `expired` from that callback. Esc resolves `undefined` without
  `onExpire`, so the two are distinguished exactly instead of by elapsed
  time (ADR-024's time-based split remains only for the select fallback).
- TUI only: `askSelect` takes the custom path when `ctx.mode === "tui"` and
  `ui.custom` exists. RPC keeps `ui.select`, and print/JSON are headless.
  The fallback still appends the footer as the last title line, so the
  contract tests and RPC behavior are unchanged.
- `askMain`, `askRememberFile`, `askRememberHost`, the credential screen, and
  the exposure gate pass the footer to `askSelect` as data instead of
  embedding it in the title string.

## Consequences

- TUI prompts now show `Default: Yes, just this once (15s)` and drop the line
  on the first arrow key; screen 2 and the credential/exposure prompts behave
  the same way.
- The extension takes a peer dependency on `@earendil-works/pi-tui`. pi ships
  it with the agent, and pi's own extension examples import it; the module is
  loaded lazily so `src/ui/ask-flow.ts` and the contract tests stay free of
  pi-tui imports.
- `ui.custom` is unavailable in RPC mode, so RPC keeps the static footer and
  the time-based Esc/expiry split.
- The selector keeps the previous clamp-on-arrow behavior (↑ at the top and
  ↓ at the bottom do nothing) even though pi's `SelectList` wraps at the
  ends, because the ask prompts have always clamped.
