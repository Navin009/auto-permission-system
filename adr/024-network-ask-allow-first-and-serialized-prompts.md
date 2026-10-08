# ADR-024: Network asks allow-first, and prompts are serialized

**Status:** Accepted

## Context

ADR-023 gave unknown network hosts the same screen 1 as file asks: `Block
(default)` / `Allow once` / `Allow for this session` / `Allow and remember…`.
Two problems surfaced with `composio execute`:

- **Unattended prompts deny, then clients retry.** The network prompt is issued
  inside a running bash command, per proxy connection. A default of Block means
  an unanswered prompt kills the connection; HTTP clients (telemetry, retrying
  SDKs) open a new one, which prompts again. The user sees a command that never
  finishes and no output (observed: `timeout 90`, `EXIT=124`).
- **Overlapping `ui.select` calls hang the command.** The proxy asks per
  connection, so two unknown hosts produce two asks within seconds (observed:
  `us.i.posthog.com` and `backend.composio.dev`). pi's TUI selector is a
  singleton: the second select replaces the first on screen, and when the first
  prompt's countdown later fires its cancel path it disposes the *second*
  selector. That second promise never settles — and `filterNetworkRequest`
  awaits it before deciding the connection, so bash hangs until its own
  timeout.

## Decision

- **Network screen 1 is allow-first (ADR-024).** Order:
  `Allow (default)` / `Deny` / `Allow for this session` / `Allow and remember…`.
  Enter allows; Deny is the second option.
- **An unanswered countdown on a network ask resolves to Allow once.** Esc
  still denies. pi resolves both as `undefined`, so the shared ask flow
  (`src/ui/ask-flow.ts`) distinguishes them by elapsed time, measured *inside*
  the prompt queue so time spent waiting behind another prompt never counts.
- **Every prompt in this extension passes one process-wide FIFO queue**
  (`askSelect`). The queue lives on `globalThis` because pi loads each
  extension with its own jiti module cache (`moduleCache: false`), so Layer 1
  and Layer 2 do not share module state even though both import
  `src/ui/ask-flow.ts`. Concurrent asks — two unknown hosts, a network ask
  plus a write ask — are shown one at a time, so pi never receives two
  overlapping selects.
- **File and credential asks are unchanged:** `Block (default)` first, a
  countdown blocks, and the absolute-deny two-step keeps both steps
  blocking-by-default. `deniedDomains` and `strictAllowlist: true` remain hard
  denies that never prompt.
- Screen 2 (`Allow for this host (…) - Scope this project|global`) is
  unchanged and stays allow-first; its countdown still denies, because a scope
  grant must be chosen deliberately.

## Consequences

- An unattended network prompt no longer deadlocks a bash command. The worst
  case is an Allow-once grant for the command in flight, never a session or
  remembered grant.
- Serialization adds latency only: a second unknown host's prompt waits for
  the first to be answered or to expire. Single-flight per host still dedupes
  parallel connections to the same host.
- Residual risk: a pi-internal selector (project trust, model picker) can
  still replace an extension prompt mid-flight; the queue only serializes this
  extension's asks (`security/manifest.json` knownGaps).
- The Esc/expiry distinction is time-based. An Esc pressed exactly at the
  deadline is treated as expiry; every other Esc exits immediately and denies.
