# ADR-020: YOLO as a persisted third permission mode, and why `--yolo` missed Layer 2

**Status:** Accepted. Amends ADR-002 (the escape hatch stays) and ADR-018 (extends `/permission-mode`).

## Context

Three problems surfaced together:

1. **`--yolo` only disabled Layer 1.** `guard.ts` is supposed to skip Layer 2
   when `--yolo` is set, but pi's loader scopes flags per extension:

   ```js
   // pi dist/core/extensions/loader.js
   getFlag(name) {
     if (!extension.flags.has(name)) return undefined;
     return runtime.flagValues.has(name) ? runtime.flagValues.get(name) : pendingFlagValues.get(name);
   }
   ```

   `yolo` / `no-sandbox` were registered only by `sandbox.ts`. Inside
   `guard.ts`, `pi.getFlag("yolo")` therefore returned `undefined`, the yolo
   branch never ran, and Layer 2 stayed fully active under `--yolo`. With
   `mode: advanced-secure`, every read whose content looked secret-ish raised
   `⚠ Sensitive information detected` — the user saw the secret prompts while
   the footer said YOLO was on. The same dead check made
   `permission-mode.ts`'s chip guard ineffective.

2. **YOLO could not be turned on without restarting pi.** ADR-002's escape
   hatch is a CLI flag; ADR-018's `/permission-mode` only persisted
   `default` / `advanced-secure`. Users who want to stop the prompts had to quit
   and relaunch.

3. **YOLO was not remembered like the other modes.** An earlier revision of
   this ADR made the toggle session-only. In practice that was surprising: every
   other `/permission-mode` choice persists, so a user who deliberately picks
   YOLO expects the next session to honor it too.

The unwanted part of an escape hatch is leaving it on by *accident*. The user
asked for parity with the other modes, so YOLO persists — with a loud, always
visible state (chip + startup banner) instead of an implicit one.

## Decision

- **One flag owner, broadcast over the bus.** `src/shared/yolo.ts` owns
  `registerYoloFlags(pi)` (both `yolo` and the `no-sandbox` alias) and
  `yoloFromFlags(pi)`; **only `sandbox.ts` calls them**. Registering the same
  flag from three extensions would list it three times in `--help` (`printHelp`
  uses a `flatMap`, not the de-duplicated `getFlags()`), so `guard.ts` and
  `permission-mode.ts` do not read flags at all. `sandbox.ts` emits the startup
  state on `pi.events` first thing in `session_start`, before any `await`.
  `package.json` loads `sandbox.ts` first, and pi dispatches `session_start`
  handlers sequentially (`await handler(...)`), so the broadcast reaches the
  other entrypoints before their own handlers run.
- **YOLO is a third persisted mode.** `PermissionMode` becomes
  `"yolo" | "default" | "advanced-secure"`, and `mode: "yolo"` is written to the
  global `~/.pi/agent/extensions/sandbox.json` by `setPolicyMode()`. The mode
  ladder (`MODE_ORDER`) becomes weakest → strictest, so the tighten-only merge
  for an untrusted project can only move a project file *up*: a project cannot
  turn on YOLO, and cannot drop Advanced Secure.
- **`--yolo` stays a per-run flag.** It is not written to disk; a persisted
  `mode: "yolo"` is not a flag. At `session_start`,
  `runtimeYolo = yoloFromFlags(pi) || loadConfig(cwd).mode === "yolo"`.
- **One menu pick.** `/permission-mode` lists `Default` / `Advanced Secure` /
  `YOLO — disable ALL security layers`, all with the same single-select
  behavior. Esc keeps the current mode.
- **The switch travels over pi's event bus.**
  `emitYolo(pi.events, enabled)` / `onYolo(pi.events, handler)` on the
  `auto-permission-system:yolo` channel, because the entrypoints share no memory
  (ADR-018). `guard.ts` recomputes `active = policyEnabled && !yolo`;
  `sandbox.ts` tears the sandbox down or re-initializes it in place.
- **YOLO outranks every rule.** While it is on, Layer 2 returns before any
  policy read and Layer 1 uses the plain bash tool.
- **No quiet transitions.** Entering YOLO shows the warning notice; every layer
  draws the `⚠️ YOLO` footer chip; the next session prints the YOLO startup
  banner. Default and Advanced Secure go back to the normal mode notices.

## Consequences

- `--yolo` now actually disables Layer 2, including the Advanced Secure output
  gate. Sessions that previously ran `--yolo` with `advanced-secure` had Layer 2
  on by accident; they now get genuinely no prompts.
- YOLO survives a restart because it is a persisted mode, exactly like
  `default` / `advanced-secure`. The global `sandbox.json` is the single record
  of the choice.
- The shipped `sandbox.default.json` still ships `"mode": "default"`, so a new
  install is secure. Only an explicit user action writes `"yolo"`.
- A project-local `.pi/sandbox.json` cannot enable YOLO even when it is trusted
  by hash; moving to a stricter mode is allowed.
- The bug class is bigger than YOLO. Any extension reading a flag another
  extension registered gets `undefined`; cross-extension state belongs on
  `pi.events`, not on flags.

## Follow-ups

- On Linux a slow `bubblewrap` start still means a short wait before the first
  bash after YOLO-off; the bash tool gates on the in-flight start promise, and
  `user_bash` awaits it too.
- Surface the current mode in `/security` output, next to `hasUI`.
