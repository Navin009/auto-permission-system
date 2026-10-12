# ADR-039: The first navigation ends the ask countdown

**Status:** Accepted

## Context

Every ask-tier prompt has a countdown that resolves to the prompt's default
when it runs out (ADR-024): an unanswered network prompt becomes
"Yes, just this once", a file prompt becomes "No". Because a user who is
reading the options should not run the prompt out, v3.5.3 reset the timer on
↑/↓, and ADR-031 hid the `Default: … (Ns)` footer on the first navigation.

That combination produced two problems in practice:

- Hiding the footer made the timer *look* stopped. Users navigated to a row,
  kept reading, and were auto-answered — a network connection was allowed even
  though they had started choosing. The timer was silently running from the
  restarted point.
- The countdown never selected the highlighted row; it always resolved the
  prompt's default. So navigation changed nothing about what an expiry would
  do — it only bought a fresh window.

A user who has started interacting is deciding; the timer's purpose (a safe
default for an untouched prompt) no longer applies.

## Decision

- In the TUI selector (`src/ui/ask-selector.ts`), the first navigation sets an
  `engaged` flag, hides the footer, and **cancels** the countdown instead of
  restarting it. After that, only Enter or Esc resolves the prompt.
  `expire()` is guarded so a stale tick cannot fire after engagement.
- The select fallback (`src/ui/ask-flow.ts`, RPC/print/tests) does the same:
  navigation clears the timeout and marks the attempt engaged. It now returns
  `{ picked, expired }`, with `expired` set by the timer itself. When an
  `onTerminalInput` hook is available, an engaged prompt never expires; when no
  hook exists, expiry still falls back to the elapsed-time split (ADR-024), so
  contexts that cannot observe navigation keep working. This also fixes
  Esc-after-the-timeout being read as an expiry when the hook is present.
- An untouched prompt keeps the old behavior: the countdown runs and resolves
  the default (allow-once for network, block for files). `timeoutMs: 0` still
  disables the countdown entirely.

## Consequences

- A user who presses ↑/↓ is never auto-answered. The network allow-once default
  can no longer approve a connection while the user is choosing, and a file
  prompt cannot be auto-blocked mid-choice.
- The `Default: …` footer disappears at the same moment the countdown stops, so
  the screen no longer implies a timer that is no longer going to fire.
- An untouched prompt still protects a headless or walked-away user with the
  same default, and the audit trail is unchanged (`decision: "yes"` for
  allow-once, `"no"` for block).
- This narrows ADR-024/ADR-031: their default-on-expiry behavior now applies
  only to a prompt the user has not navigated.
- Regression coverage: `security/tests/unit/ask-selector.mjs` (navigation then
  long wait is not an expiry; Enter selects the highlighted row; Esc cancels)
  and `security/tests/contract/ask-flow.mjs` (select fallback navigation
  cancels the countdown).
