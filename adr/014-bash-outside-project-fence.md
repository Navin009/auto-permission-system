# ADR-014: bash honours the outside-project boundary; `~/.pi/agent` is no longer exempt

**Status:** Accepted

## Context

Two gaps let the model read outside the project with no prompt and no audit entry (issue #8):

1. `filesystem.outsideProject.read` was implemented by Layer 2 only, and Layer 2's `tool_call` handler has no `bash` branch. Layer 1 wraps `bash` but was initialised with only `denyRead` / `allowWrite` / `denyWrite`; it never received `outsideProject` or `filesystem.allowRead`. So the project boundary did not exist at the OS layer: one `ls ~` read anything not explicitly denied.
2. `outsideProjectReason()` unconditionally trusted `getAgentDir()`. Everything under `~/.pi/agent` (including `mcp.json`, whose `env` block holds API keys, plus sessions and caches) was readable with no prompt; only `auth.json` was saved by the absolute-deny tier.

## Decision

- **Extend the boundary to bash.** `lib/guard-lib.ts` gains `sandboxFilesystem()`, which translates the policy into the `filesystem` block handed to sandbox-runtime. When `outsideProject.read` is `ask` or `deny`, it adds the home directory and the project's parent to `denyRead`, then re-exposes the project, the `allowWrite` roots and `outsideProject.allowRead` via `allowRead`. sandbox-runtime resolves `allowRead` as a re-allow within a denied region, and explicit file denies (`.env`, `*.pem`, `~/.ssh`) keep winning over a directory `allowRead`.
- **The OS layer cannot prompt**, so `ask` and `deny` both block at Layer 1. After the command fails with `EPERM`, the existing post-block hook classifies the path: a hard `denyRead` match is reported and never granted, while an outside-project path under `ask` offers a read grant. "Always" writes `overrides.allowRead` (file-level only; no folder grant for reads).
- **Fold `overrides.allowRead` into `filesystem.allowRead`** in `foldOverrides()`, so a read grant the user made at the ask-tier prompt actually reaches Layer 1. This cannot unmask a secret: Layer 2 refuses "always" for the absolute-deny tier, and sandbox-runtime keeps explicit file denies winning over a re-exposed directory.
- **Stop exempting `~/.pi/agent`.** `getAgentDir()` is removed from `outsideProjectReason()`'s allow-roots, and `"~/.pi/agent"` joins the shared `DEFAULT_DENY_READ` list (`lib/guard-lib.ts`) used by both layers. `auth.json` stays in the absolute-deny tier.
- `DEFAULT_DENY_READ` / `DEFAULT_ALLOW_WRITE` / `DEFAULT_DENY_WRITE` move to `lib/guard-lib.ts`, so the two layers cannot drift. `applyUntrustedProject` keeps tightening both.

## Consequences

- With `outsideProject.read: "ask"` or `"deny"`, `bash` reading outside the project fails and is audited (`layer: 1, tool: "bash", decision: "read-denied"` or `always-cwd`/`always-global`), matching the native tools.
- With the default `outsideProject.read: "allow"`, Layer 1 still fences only what `denyRead` names; the boundary is off, as before.
- `~/.pi/agent` is now prompted/blocked by default in both layers, including `bash`. `auth.json` remains absolute-denied and non-overridable.
- Denying the home directory can block legitimate tooling that reads `~/.config`, `~/.cache`, etc.; those are exactly the paths the outside-project gate is meant to make the user aware of, and `outsideProject.allowRead` (or flipping `read` to `allow`) is the escape hatch.
- `security/tests/outside-fence.mjs` locks in the fence shape and the classification; the interactive prompt path stays manual.
