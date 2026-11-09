# ADR-047: Wide writes, a narrow read gate, no vendor registry

**Status:** Accepted

## Context

v4.0.0 hardened by where files live: `denyRead` named whole credential folders
and `denyWrite` named `.env` / `*.pem`. Two things went wrong.

- **It broke ordinary CLI work without protecting a token.** Docker writes
  `~/.docker` and needs the socket; composio writes `~/.composio`; gh, aws,
  kubectl, npm and cargo all keep state under `$HOME`. With `allowWrite` of
  `[".", "/tmp"]` every one of them died on `EROFS`. A *write* does not leak a
  token — it becomes dangerous only when it lands in key material or in a file
  that runs code.
- **A folder plus file names is the wrong shape.** `askRead: ["~/.aws"]` already
  works (patterns are prefix tests), but the shipped list named individual files,
  which misses every file a vendor adds. Meanwhile every prompt was per file: the
  L1 conversation grant stored the exact path, so reading three files in one
  credential store cost three prompts.

## Decision

1. **Writes are wide.** `allowWrite` becomes `[".", "/tmp", "~"]`. `denyWrite`
   keeps key material only (`~/.ssh`, `~/.gnupg`, `~/.pi/agent/auth.json`;
   `*.pem` / `*.key` stay absolute-denied by the credential tier).
2. **`askWrite` is the critical-file gate**, and it is enforced in both layers:
   `isDeniedWrite` now checks `askWrite` after `denyWrite` and before
   `allowWrite`. A sudden update of `.env`, `.npmrc`, `.git-credentials`,
   `credentials`, `hosts.yml`, `mcp.json`, a shell startup file or the pi
   extensions folder prompts even though `~` is writable. A once/session answer
   settles it for the conversation.
3. **Reads stay on the existing keys — no new schema key, no vendor list.**
   `askRead` may name a folder (`~/.aws`) and covers everything beneath it,
   including files that appear later. The shipped defaults carry the stores
   almost every machine has (`~/.aws`, `~/.kube`, `~/.docker`,
   `~/.config/gcloud`) and *not* product-specific folders: a vendor folder is one
   line of local config, and the content scan is the generic backstop.
4. **`filesystem.allowRead` beats an `askRead` folder**, and `denyRead` beats
   both. That is the escape hatch for a store whose files are not all secret
   (`allowRead: ["~/.aws/config"]`), without weakening the list itself.
5. **Conversation grants are folder-scoped in both layers** via the new
   `isSessionFolderGrant` (anything but `/` and `$HOME`), while a *permanent*
   grant keeps `isSafeFolderGrant` (credential and system folders refused). One
   answer now settles a store for the conversation; nothing can be persisted for
   `~/.ssh`.

## Consequences

- `docker build`, `docker login`, `composio`, `gh`, `aws`, `kubectl`, `npm` and
  `cargo` keep working inside the sandbox: their writes land under `~`.
- Writing `.env` asks instead of blocking, so `cp .env.example .env` is one
  prompt (and one answer for the conversation), not a wall.
- A store added later is covered by one line; nothing here needs a vendor
  registry, and the path list can stay short.
- **Writes are no longer a security boundary.** The guarantee moved to the read
  side: `denyRead` for key material that can never be masked, `askRead` for
  credential stores, the Advanced Secure output scan for everything that reaches
  the model, and (next) `credentials` masking so a tool can use a token the model
  never sees. This is recorded as a known gap in the manifest.
