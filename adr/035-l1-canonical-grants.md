# ADR-035: Layer 1 grants the canonical path, and an ineffective grant cannot loop

**Status:** Accepted

## Context

ADR-006 says symlinks must be canonically resolved before a path is matched
against policy or shown to the user, and Layer 2 does that
(`src/l2-guard/matching.ts`). Layer 1 did not. `extractBlockedPath`
(`src/core/policy/patterns.ts`) is pure text parsing: it recovers the operand
*as the failing tool spelled it*. Every L1 decision then used that spelling —
the denyRead match, the outside-project match, and the `once` / `session` /
`remember` grant written to `allowWrite`.

A symlinked path (`cwd/node_modules -> /home/me/checkout/node_modules`) exposed
two failures at once:

- **sandbox-runtime never binds the spelled root.** Its allowWrite loop calls
  `realpathSync` and `isSymlinkOutsideBoundary`, and `continue`s when the
  resolved path escapes the spelling. Verified against the installed runtime:
  `allowWrite: ['/tmp/sym-a/node_modules/.vite']` produces no `--bind`, while
  the canonical `/tmp/sym-b/nm/.vite` does. So a grant on the spelling silently
  no-ops.
- **The re-run hits the exact same fence.** `once` grants the parent directory
  and re-runs the command; with the binding skipped, the command fails again
  with `EROFS`. The extension then sees the same offending path, hides `once`
  (already granted), and offers `session` / `remember` — each of which also
  no-ops. Every pick executes the command again: the user-visible "allowed once
  — re-running the command" warning, twice or in a loop.

Attribution had a second hole. The write branch only checked `denyRead` for a
hard deny; it never checked `denyWrite`. But sandbox-runtime applies denies
*after* allows, so a `denyWrite` path can never be opened by a grant. The
extension still offered `once` / `session` / `remember` for it, and each re-run
failed again — the same loop, no symlink required.

Pre-flight read candidates had the same shape: `outsideProjectReadCandidates`
and `askReadCandidates` matched and granted the spelling from the command text,
so a symlinked outside read could be granted a path the runtime would skip, or
fail to match a deny the resolved path would hit.

## Decision

- Move `canonicalize` (ADR-006's walk-to-deepest-existing-ancestor realpath)
  from `src/l2-guard/matching.ts` to `src/shared/canonicalize.ts`; matching
  re-exports it, so both layers share one implementation.
- In the Layer 1 post-block handler, canonicalize the extracted path once.
  `denyRead`, `denyWrite`, outside-project matching, and every `once` /
  `session` / `remember` grant then use the canonical path. The spelled path is
  kept only for display (`Link` in the block hint and prompt body) and the
  audit trail.
- Treat a `denyWrite` match as a hard deny for writes, alongside `denyRead`:
  no grant is offered, and the reason names the matched pattern.
- Give `outsideProjectReadCandidates` and `askReadCandidates` an injected
  `resolvePath` (default identity, so the pure tests are unchanged) and pass
  `canonicalize` from Layer 1, deduping the result.
- Track `grantedWriteDirs` for the invocation. If the re-run hits the fence
  under a folder already granted in this invocation, do not prompt again:
  audit `grant-ineffective`, tell the user the grant did not take effect, and
  finish with a normal block. This holds even for a cause the runtime has not
  taught us yet.

## Consequences

- A write through a symlink is granted at its real target and works after one
  approval; the persisted `overrides.allowWrite` entry is the canonical path,
  so it keeps working across restarts.
- A symlink pointing at secret material (`~/.ssh`, `*.pem`) now *matches* the
  hard deny instead of being offered as a grant — closing an escalation the
  spelled-path matching allowed.
- `denyWrite` paths are no longer askable. The sandbox denies them after every
  allow, so a prompt could only ever produce a failed re-run.
- Prompts for symlinked blocks read `File <canonical>` + `Link <spelled>`, so
  the user still recognizes the operand their command used.
- The only remaining way to re-execute a command more than once is a grant that
  takes effect for a different path than the one that fenced; the
  `grantedWriteDirs` breaker bounds every same-folder case to a single re-run.
- The e2e sandbox tests still cover the non-symlink case; the regression for
  this ADR drives `createSandboxedBashOps` with a stubbed `SandboxManager`
  (`security/tests/unit/l1-session-grants.mjs`).
