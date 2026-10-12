# ADR-037: Layer 1 attribution keeps a path with spaces and rejects operation words

**Status:** Accepted

## Context

ADR-022 recovered the refused operand from a sandboxed command's own error
output with `extractBlockedPath` (`src/core/policy/patterns.ts`). It split the
text before the errno on `: ` and then took the **last whitespace-delimited
token** as the path.

That held for coreutils-style messages (`cat: sub/x.pem: Operation not
permitted`) but broke for two large classes of real output:

- **A path with a space is truncated.** Chrome's crash reporter prints
  `open /…/google-chrome/Crash Reports/new/<uuid>.dmp: Read-only file system`.
  The last token is `Reports/new/<uuid>.dmp`; resolved against the command's
  cwd it becomes `<cwd>/Reports/new/<uuid>.dmp`, a project path that never
  existed. The plugin then prompted to save into `<cwd>/Reports/new`, audited
  that folder, and after the grant no-opped against the real fence reported
  `grant-ineffective` (ADR-035's breaker) for the next dump file.
- **A bare operation word is treated as a path.** Electron prints
  `Failed to open socket: Operation not permitted` and `Failed to connect to
  Wayland display: Operation not permitted`. The last token becomes `socket` /
  `display`, resolved to `<cwd>/socket` / `<cwd>/display`.

In both cases the derived path is inside the project, so the generic write
branch (`src/l1-sandbox/bash-ops.ts`) prompted with a hard-coded
`Why outside your project, not on your allowed list` — describing a project
path as outside the project — and offered a grant that could never take
effect.

## Decision

- Keep the whole unquoted operand instead of its last whitespace token. After
  splitting the pre-errno text on `: `, strip the diagnostic lead-in
  (`[pid:…]`, `open`, `cannot touch|remove|create|open|stat|access`,
  `touch`, `creat`, `unlink`, `mkdir`, `rmdir`, `rename`) and treat the rest as
  one candidate.
- Only accept a candidate that looks like a file (`looksLikePath`): rooted,
  starts with `~` or `.`, contains `/`, or carries an extension. A candidate
  with whitespace must contain `/`. This keeps
  `Crash Reports/new/x.dmp` and rejects `Failed to open socket`,
  `. socket() failed`, `socket`, `display`, and `failed`.
- Make the generic write prompt's `Why` line reflect the real cause
  (`not under an allowWrite root` for a write fence) instead of asserting the
  path is outside the project.

Quoted operands (the most reliable form) are still tried first, so the
existing `cannot touch 'x.pem'` / `open '/abs/path'` cases are unchanged.

## Consequences

- A path with spaces is attributed correctly, so the prompt names the real
  operand and a grant can actually take effect.
- Operation words no longer fabricate an in-project path; when nothing
  path-like can be recovered `extractBlockedPath` returns `undefined`, the
  generic write branch is not entered, and the model gets the plain block hint
  (ADR-022's attribution is post-hoc: unattributable output stays a normal
  block).
- Bare relative names without an extension (`Makefile`) are no longer
  attributed from unquoted output; they were already indistinguishable from
  operation words, and a quoted operand still recovers them.
- Regression coverage lives in
  `security/tests/unit/l1-attribution.mjs` (space-in-path, pid-prefixed errno,
  and the `socket` / `display` / `failed` operation words).
