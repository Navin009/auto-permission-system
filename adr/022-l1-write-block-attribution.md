# ADR-022: Layer 1 detects EROFS write blocks and never routes a failed write to a read grant

**Status:** Accepted

## Context

Layer 1 enforces the write fence at the OS level: every path outside
`filesystem.allowWrite` is presented read-only. The extension cannot intercept
the write at the syscall, so it reconstructs the denial from the command's output
after the fact and offers the write prompt (ADR-021).

That attribution only recognized `operation not permitted|EPERM|EACCES`. On
Linux, bubblewrap's read-only bind mounts fail a write with **EROFS** and a
message that puts the operand *after* the error token:

```text
Could not update /home/me/.pi/agent/mcp.json: EROFS: read-only file system, open '/home/me/.pi/agent/mcp.json'
touch: cannot touch '/tmp/x/pwned': Read-only file system
[Errno 30] Read-only file system: '/srv/data'
```

The disk itself is writable (`/home` is `rw`); the read-only view is the
sandbox. Because the regex missed EROFS, a Linux write outside `allowWrite`
produced:

- no path attribution (`extractBlockedPath` returned `undefined`),
- no write prompt (the ask branch sits behind the blocked-access detection),
- no read/write classification — the raw errno was all the model and user saw.

A second defect surfaced once the output *was* recognized: a failed write to a
path that also matched a read-deny pattern (for example `~/.pi/agent/mcp.json`
in a config that lists it under `denyRead`) was classified as a refused *read*.
With `outsideProject.read: "ask"` that offered a read grant for a write that
would fail again identically.

## Decision

- Recognize `EROFS` and `read-only file system` as blocked-access evidence,
  alongside `EPERM`/`EACCES`/`operation not permitted`
  (`isBlockedAccessError` in `src/core/policy/patterns.ts`).
- Extract the operand from errno-style messages, where the path follows the
  error token and is quoted (Node, Python, coreutils), in addition to the
  existing `tool: path: error` shape (`extractBlockedPath`).
- Treat EROFS as proof the refused access was a write (`isWriteBlockError`).
  EPERM/EACCES stay direction-ambiguous.
- A refused write is never outside-project-*read* evidence: Layer 1 skips the
  outside-read classification for it so the write prompt fires instead of a
  read grant that cannot fix the failure.
- When the path is also in `denyRead`, the hard deny still wins and the
  model-facing line is a write-worded refusal rather than a grant.
- Headless sessions (`ctx.hasUI === false`) get an explicit blocked line for a
  write, so the model does not have to infer the fence from an errno.

No per-path `askWrite` entries are involved. The rule is the same general one
Layer 2 already applies: anything outside `allowWrite` asks.

## Consequences

- Layer 1 and Layer 2 agree: a write outside `allowWrite` asks in both, and
  `allowWrite` (or an ask-tier grant persisted into `overrides.allowWrite`)
  remains the only opening.
- macOS behavior is unchanged: sandbox-exec already reports EPERM, which the
  existing prompt handled.
- `extractBlockedPath` now prefers the last quoted token on a blocked line.
  A command that quotes unrelated strings next to the error can still fool the
  heuristic; the prompt shows the attributed path, so a wrong attribution is
  visible before anything is granted.
- The opt-in e2e suite asserts real OS behavior: a write outside `allowWrite`
  is refused, its path is attributed, and on Linux it is classified as a write.
