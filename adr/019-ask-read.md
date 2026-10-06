# ADR-019: Sensitive reads ask instead of hard-deny

**Status:** Accepted

## Context

`.env` and `.env.*` shipped inside `filesystem.denyRead`. That list meant two
different things per layer:

- **Layer 2** (`read` tool): `isDeniedRead` matched and then `gateRead` asked
  (Block / Allow once / Allow for this session / Allow and remember…). So it
  already behaved as an ask.
- **Layer 1** (bash): sandbox-runtime masked the file with an empty tmpfs, exit
  0, **no prompt**. `cat .env` silently returned nothing.

So the same policy line was an ask in one layer and a silent hard block in the
other. The intent is: sensitive paths should **ask**, and only a path the user
explicitly denies should be hard-denied.

## Decision

- **New `filesystem.askRead` list.** `sandbox.default.json` moves `.env` and
  `.env.*` from `denyRead` to `askRead`. They stay in `denyWrite` (writing
  secrets is a different risk).
- **Layer 2:** `isAskRead` (matching.ts) runs in `gateRead` after
  `isDeniedRead`; a match takes the normal ask path. `denyRead` still wins.
- **Layer 1:** the paths are no longer handed to sandbox-runtime (they are not
  in `denyRead`, and `sandboxFilesystem` builds only
  `{denyRead, allowRead, allowWrite, denyWrite}`, so `askRead` never leaks). A
  new bash pre-flight, `preflightAskReads`, asks before a plainly-read
  `askRead` path runs the command. Headless (no UI) fails closed.
- **Precedence:** `denyRead` > `askRead` > allowed. A path in both is denied.
- **Trust:** `askRead` joins the additive list in `applyUntrustedProject`, so an
  untrusted project may add ask entries (tightening), never remove yours.
- **Credentials are unchanged.** The absolute-deny tier (`~/.ssh`, `~/.aws`,
  `~/.gnupg`, `*.pem`, `*.key`, `auth.json`) stays a deliberate two-step with no
  "remember".

## Consequences

- `read .env` asks in both modes, and `cat .env` in bash asks instead of
  returning an empty file.
- Headless runs block `askRead` reads (no prompt is possible).
- The pre-flight scan is best-effort, like ADR-015: only read-like segments
  (`cat`, `less`, `grep`, …), only existing tokens. An obfuscated read (variable
  expansion, a script) is not asked. That is an accepted gap: the OS boundary
  used to cover it, and `askRead` deliberately does not, so a determined
  obfuscated read can now succeed. Users who want the old hard block put the
  path back in `denyRead`.
- `security/tests/unit/ask-read.mjs` locks the list, the precedence, and that
  sandbox-runtime never sees `askRead`.
