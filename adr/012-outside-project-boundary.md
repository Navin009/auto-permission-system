# ADR-012: Reads outside the project can ask; a named path runs once

**Status:** Accepted

## Context

Layer 2 limited writes to `allowWrite` roots but let pi's own tools read anywhere that `denyRead`, `modelDenyRead` and the absolute-deny tier did not cover. A prompt-injected or confused agent could read other repositories, dotfiles or documents outside the task without the user noticing. Other permission layers for pi model this as an "external directory" boundary with its own rules; the idea is useful on its own.

## Decision

- `filesystem.outsideProject.read: "allow" | "ask" | "deny"`, default `"allow"` (no behaviour change unless set), and `filesystem.outsideProject.allowRead` roots.
- Applies to `read` and to the search roots of `grep`, `find` and `ls`, after the read policy (a `denyRead` hit keeps its own handling).
- Never asked about: the project directory (canonical), `allowWrite` roots, the pi agent dir, pi's own package directory (docs, examples), `allowRead`, and persisted `overrides.allowRead`.
- `"deny"` blocks without a prompt. `"ask"` uses the ask-tier prompt (session grants and "always" options apply).
- **User named it:** in an interactive session, a read whose full path (absolute or `~/…`, as canonicalized or as the call spelled it) appears as a whole token in one of the user's own messages runs once without a prompt, audited as `user-named`. Only session entries with role `user` count; assistant text, tool results and file contents never do. Bare file names do not count outside the project. Headless sessions never use it, because their "user" message may be written by another model.
- Writes outside the project stay governed by `allowWrite`.

## Consequences

- With `"ask"`, the agent reads outside the project only where the user pointed it, or after a prompt.
- Headless harnesses that read outside the project need `allowRead` entries or `"allow"`.
- A path the user mentions in passing counts as named. The absolute-deny tier and `denyRead` never depend on naming.
