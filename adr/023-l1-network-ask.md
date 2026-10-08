# ADR-023: Layer 1 network asks, with per-command once grants

**Status:** Accepted
**Amended by:** ADR-024 (network screen-1 order, countdown default, prompt serialization)

## Context

Unknown domains were asymmetric between the layers. Layer 2 (`fetch_content` / `get_search_content`) already asked through the shared ask-tier prompt (ADR-003, ADR-009, ADR-010). Layer 1 registered no `SandboxAskCallback` with sandbox-runtime, so a bash command (`curl`, `git`, any HTTP client) touching a host outside `allowedDomains` was hard-denied by the proxy with no prompt — the user had to hand-edit `sandbox.json` and retry, exactly the friction ADR-003 removed for paths.

sandbox-runtime 0.0.78 exposes the missing seam: `SandboxManager.initialize(config, callback)` takes a `SandboxAskCallback` invoked per proxy request, only for hosts that match neither `allowedDomains` nor `deniedDomains`. `deniedDomains` is checked first and `strictAllowlist: true` skips the callback entirely, so both remain hard denies. `SandboxManager.updateConfig()` swaps the config the proxy reads per request without restarting it.

## Decision

- `initSandbox` registers a `SandboxAskCallback` that reuses the shared ask-decision mapper (`src/ui/ask.ts`, moved out of `src/l2-guard/` for this): same screen 1 (Block default / Allow once / Allow for this session / Allow and remember…) and screen 2 (scope project | global) as every other gate.
- **"Allow once" is scoped to the bash command, not one connection.** The proxy calls back per request, so redirects and parallel connections would otherwise re-prompt. `beginNetworkCommand` / `endNetworkCommand` wrap one bash execution (also `user_bash`) and hold a temporary grant set.
- Concurrent connections to the same host share one prompt (single-flight map).
- **"Allow for this session"** lives in memory only, is cleared at `session_start`, and is never written to disk.
- **"Allow and remember"** writes `overrides.allowDomains` — the field Layer 2 already uses — and applies the grant live with `SandboxManager.updateConfig`, never `reset()`/`initialize()`: a reload would tear down the proxy serving the request being approved. A host remembered from Layer 2's prompt takes the same live path: the guard emits on a shared event-bus channel (`src/shared/network-grants.ts`) and the sandbox entrypoint applies it.
- `deniedDomains` and `strictAllowlist` stay hard denies. Layer 2 now mirrors the same semantics: `deniedUrlReason` blocks before any prompt, so a denylist means denylist in both layers (previously Layer 2 offered to override `deniedDomains`).
- Headless (`hasUI === false`) denies, as everywhere else. Every decision is audited (`layer: 1`, `tool: "network"`).

## Consequences

- Bash egress to a new host is a prompt, not a dead end, with the same once / session / remember vocabulary as every other gate, and the approved request completes without a retry.
- The callback receives only `{ host, port }` — sandbox-runtime does not pass command identity — so a per-command grant is the finest "once" scope available. It is process-wide and can briefly cover a concurrent `user_bash` command to the same host; the L1 `knownGaps` entry records this.
- The grant is persisted as a bare host (both layers match hostnames); a non-default port is shown in the prompt but not stored.
- Asking is the default for interactive sessions. `"network": { "strictAllowlist": true }` restores silent hard-deny for users who want the old behavior.
