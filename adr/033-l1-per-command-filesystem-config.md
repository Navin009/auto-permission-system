# ADR-033: Layer 1 rebuilds the filesystem policy for every bash command

**Status:** Accepted
**Amended by:** —

## Context

`SandboxManager.initialize()` captures the policy once at `session_start`. Every later change to `sandbox.json` reached the running bash sandbox only through an explicit reload:

- Layer 1's own "remember" branches call `persistLayer1Override()` → `reloadSandbox()`, and a network "remember" uses `applyNetworkGrant()` (`updateConfig`), so those grants are live (ADR-023).
- **Layer 2's "remember" does not.** `persistOverride()` (`src/l2-guard/prompts.ts`) writes `overrides.allowWrite` / `overrides.allowRead` to `<cwd>/.pi/sandbox.json` for the in-process tools; nothing tells the already-initialised Layer 1 sandbox. A bash command touching the same path is still fenced by the stale config, so the user sees the path they just allowed refused again. The same staleness hides a hand-edited `sandbox.json` until `/sandbox reload` or a restart.
- A session/once grant masks the problem because `buildCustom()` already re-read `loadConfig(cwd)` — but only when `readRoots`/`writeRoots` were non-empty, and the no-grant case returned `undefined` (use the initialised config).

## Decision

`buildCustom()` in `src/l1-sandbox/bash-ops.ts` always returns a `filesystem` block built from a fresh `loadConfig(cwd)`, merging the once/session grants on top. `wrapWithSandbox(command, undefined, customConfig)` therefore gets the current on-disk policy on every command; `customConfig.filesystem` overrides the initialised filesystem section-by-section in sandbox-runtime (the same path the once/session grants already used).

The network section is deliberately **not** passed per command: the proxy is a process-wide resource and `applyNetworkGrant()` / `updateConfig()` already keeps it current without a reset.

A full `reloadSandbox()` on a Layer 2 write was rejected: `reset()` + `initialize()` tears down the proxy and the seatbelt/bwrap mounts while commands may still be running, and the per-command override achieves the same freshness with no teardown. The `projectTrusted` flag handed to the Layer 1 network ask was also switched from pi's folder-level `ctx.isProjectTrusted` to the extension's own `projectTrusted(cwd)` (the `<cwd>/.pi/sandbox.json` hash in `sandbox.trust.json`) so the screen-2 rows and the persist guard agree — a mismatch made "remember in this project" throw and silently degrade to a one-command grant.

## Consequences

- A "remember" from either layer, or a hand edit to `sandbox.json`, takes effect on the next bash command without `/sandbox reload` or a restart. The `overrides` section is the single source of truth for both layers.
- `loadConfig()` runs once more per bash command (the pre-flights already called it up to three times), and `sandboxFilesystem()` is recomputed per command; the cost is a few small file reads and JSON parses.
- The per-command config cannot loosen anything the initialised config would not: it is the same `sandboxFilesystem()` over the same merged policy, and credential tiers (`absolute-deny`, `denyRead`, `denyWrite`) are evaluated inside it unchanged.
- An untrusted project file still cannot widen anything: `loadConfig()` applies `applyUntrustedProject` before `foldOverrides`, so its `overrides` never enter the per-command config.
