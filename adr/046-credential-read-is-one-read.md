# ADR-046: A credential read is one read, and a grant needs a named path

**Status:** Accepted

## Context

Two prompts disagreed with their own documentation.

- **`askRead` could be remembered.** The absolute-deny tier refuses `always`, but
  an `askRead` hit (`.env`, `.npmrc`, `.git-credentials`) went through the generic
  ask path, which offers "Yes, always…". The answer was written to
  `overrides.allowRead`, and `isAskRead` consults overrides **first**, so the file
  never asked again. ADR-019 and the prompt text both say the opposite.
- **A grant target came from command output.** `handleBlockedBashExecution`
  derives the offending path from the EROFS/EPERM text. A command that prints
  `EROFS: read-only file system, open '/home/u/.ssh/id_rsa'` and exits non-zero
  makes the UI offer "Let <binary> save files in /home/u/.ssh/?" with an
  `always` option, for a path the command never touched. `isSafeFolderGrant`
  only excluded `/` and `$HOME`, so `~/.ssh` was offered as a folder grant.

## Decision

- **`AskKind.credentialOnly`** is set by `checkReadAccess` when the reason came
  from `isAskRead`. `askDecision` treats it like the absolute-deny tier: two
  options, one read, never remembered, never persisted.
- **`isSafeFolderGrant` refuses protected folders**: `~/.ssh`, `~/.gnupg`,
  `~/.aws`, `~/.azure`, `~/.kube`, `~/.docker`, `~/.pi`, `~/.config`, and the
  system directories (now one exported `SYSTEM_FOLDERS` set, also used by the
  prompt icon logic). A file-level grant is still offered.
- **`commandMentionsPath`** (core) answers whether the command itself names the
  path: every segment, every token, normalised the same way as the policy match,
  plus a basename comparison so `touch blocked.txt` counts. Both recovery
  prompts pass `remember: commandMentionsPath(…)`; when it is false the prompt
  keeps `once` / `session` and drops "always".
- **The grep result filter honours `askRead`** as well as `denyRead`: a
  recursive grep no longer prints the contents of a file the read tool would
  have asked about.

## Consequences

- Reading `.env` with the `read` tool asks every time; an old
  `overrides.allowRead` entry written by hand still wins (explicit user intent).
- A forged sandbox-error prompt can still ask for a one-off or session grant for
  an arbitrary folder, but it can no longer create a permanent rule. The audit
  entry records the path that was named, not only the fabricated one.
- `grep -r` over a folder redacts askRead files and says how many lines it
  removed, matching ADR-008's behaviour for denyRead.
