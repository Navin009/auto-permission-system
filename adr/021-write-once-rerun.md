# ADR-021: Layer 1 write blocks offer "allow once" by re-running the command

**Status:** Accepted

## Context

Layer 1's post-block prompt for a write outside `allowWrite` called
`askMain(..., { once: false })`, so it offered only `block` and
`allow and remember…`. That contradicts ADR-003, which defines
`yes — this once` as the first duration tier, and made L1 bash writes the only
ask path without it: L2's write/edit tools offer once and session, and L1 reads
get once from the ADR-015 pre-flight.

A write is detected only *after* the sandboxed command has already failed with
`EPERM`. There is no pre-flight moment at which to hand a one-time grant to
`wrapWithSandbox` the way reads do, and the command has already run — a "once"
that does not re-run would grant nothing.

## Decision

- Offer `allow once` on the L1 write prompt: `askMain(..., { once: !alreadyGranted })`.
- `once` re-runs the same command in the same `exec` call with the offending
  path's **parent directory** added to `filesystem.allowWrite` through the
  per-invocation `SandboxManager.wrapWithSandbox` `customConfig`. Nothing is
  persisted and the session-wide sandbox is not re-initialised.
- The parent directory (not the file) is granted so that creating a new file works.
- A directory already granted in this invocation is not offered `once` again, so a
  command that keeps hitting the same fence cannot loop.
- The re-run is audited (`decision: "once"`, `scope: "invocation"`,
  `note: "write-once"`) and announced to both the user and the model.
- `remember` is unchanged and still persists to `sandbox.json`.

## Consequences

- L1 bash writes now match ADR-003's tiers (block / once / remember) and the
  shape L2 already had.
- `once` executes the command a second time, so side effects that already
  succeeded before the fence can repeat. The user approves explicitly and the
  command is visible in the transcript, which is the same trust model as the
  read pre-flight's once; the default remains `Block`.
- The grant is `allowWrite` only. `denyWrite` still wins over it
  (sandbox-runtime applies denies after allows), so `*.pem`, `.env` and
  absolute-deny paths are not opened by `once`.
- Headless (`ctx.hasUI === false`) remains block-only.
