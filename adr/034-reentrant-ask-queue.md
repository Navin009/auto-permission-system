# ADR-034: The ask queue is re-entrant; a two-screen ask holds one slot

**Status:** Accepted
**Amends:** ADR-024 (prompt serialization), ADR-031 (TUI selector)

## Context

ADR-024 put every ask through one process-wide FIFO queue (`askSelect`) because
pi's selector is a singleton: a second `ui.select` / `ui.custom` replaces the
first on screen without settling it, and the displaced promise hangs — for the
network proxy, inside a running bash command.

The queue serialized *one select at a time*, but the asks that matter most are
two-screen: screen 1 (`No / once / session / always…`) and screen 2 (scope:
folder vs file, project vs global). Screen 1 and screen 2 are separate
`askSelect` calls, so a two-screen ask spans two queue slots, and the slot is
released when screen 1 resolves.

v3.5.7 made screen 2 atomic with screen 1 by adding `skipQueue: true`
(`askRememberFile` / `askRememberHost`), bypassing the queue entirely. That
created the inverse race. When the user picks `Yes, always…` on screen 1:

1. screen 1's queued task resolves and the FIFO tail advances to the next ask
   (B) on a microtask;
2. the caller calls `askRememberFile`, which with `skipQueue` calls
   `ctx.ui.custom` immediately, on a microtask of its own;
3. screen 2 and B both reach pi's editor slot. pi's `showExtensionCustom`
   (`Container.clear()` + `addChild`) keeps only the last one — it does **not**
   call `close()`/`done()` on the one it drops.

The loser is orphaned: its promise never settles, and its own countdown later
fires `close()` → `restoreEditor()` → clears the editor slot again, wiping the
prompt that *is* on screen. Observed as: "I'm on screen 2, a new ask appears and
screen 2 vanishes", followed by an ask flow that stalls until its countdown.

## Decision

- Replace `skipQueue` with a re-entrant queue. `enqueue(fn)` runs `fn` in the
  shared global FIFO chain, unless a slot is already held by this module
  instance, in which case `fn` runs inline in that slot. `askSelect` is the only
  entry point; there is no bypass.
- Add `askMainWithRemember(ctx, header, body, opts, onRemember)`. It acquires
  one slot, runs screen 1, and on `Yes, always…` runs the caller's screen-2
  continuation (`askRememberFile` / `askRememberHost`) *inside the same slot*
  before releasing it. The continuation returns the grant, or `null` when the
  user cancelled screen 2.
- `askRememberFile` / `askRememberHost` lose `skipQueue` and call `askSelect`
  normally: inline when invoked from `onRemember`, queued when invoked alone.
- Migrate every two-screen caller: `askDecision` (L2), the three Layer 1
  filesystem asks in `bash-ops.ts`, and the Layer 1 network ask.
- `AskSelector.dispose()` settles `done(undefined)` if the prompt has not
  settled yet. This does not cover pi's silent replacement (it removes the
  child without disposing), but it covers explicit disposal (shutdown, a
  pi-internal screen that does clean up) and guarantees an unsettled ask can
  never wedge the queue forever.

## Consequences

- A two-screen ask is atomic by construction: screen 2 always follows screen 1
  immediately (the original v3.5.7 intent) without racing the next queued ask.
  Regression tests in `contract/ask-flow.mjs` assert the order
  `A1 → A2 → B1`, `maxActive === 1`, and that a standalone screen-2 helper
  still serializes.
- `holdingQueue` is module-local, not on `globalThis`: each extension bundle
  has its own copy, and the shared chain already serializes Layer 1 against
  Layer 2. Re-entrancy only ever happens inside one bundle's own slot.
- The residual ADR-024 gap remains: a pi-internal selector (project trust,
  model picker) can still replace an extension prompt. The queue prevents two
  *extension* prompts from overlapping; it cannot stop pi from showing one of
  its own. `dispose()` settling bounds the damage to one lost prompt instead of
  a wedged queue.
- A slot is now held across both screens, so a long screen 2 (60 s remember
  timeout, ADR-030) delays other asks for its duration. That is the intended
  trade-off: one prompt at a time, and the user is already mid-decision.
