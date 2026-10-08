# ADR-030: Session and remember grants use the wider scope by default

**Status:** Accepted

## Context

CLI binaries write to a cache directory outside the project (`~/.composio/`,
`~/.cache/<x>/`, `~/.npm/`, …) and connect to a vendor's API domain
(`backend.composio.dev`, `api.composio.dev`, `us.i.posthog.com`, …). After
ADR-009 / ADR-010 / ADR-023, every distinct path and every distinct host gets
its own prompt. A single `composio search` command is enough to fire four
asks in two seconds: write to `~/.composio/tool_definitions/x.json`, write to
`~/.composio/user_data.json`, network to `backend.composio.dev`, network to
`us.i.posthog.com`. The user has to answer each one, and "Allow for this
session" only covers the exact path, so the second command blocks again on a
different file under the same folder.

Two changes are needed at the ask tier itself:

- **Session grants should be wider.** Pressing "Allow for this session" once
  should cover the whole folder a CLI writes to and every sibling subdomain
  the same vendor serves. The narrower single-file / single-host grant is
  still useful for one-off tools, so the screen-1 label has to name what the
  session actually grants, not the abstract concept of a session.
- **Screen 2 (the "remember" scope pick) should default to the wider option.**
  The current order is file-then-folder, exact-host-then-wildcard — i.e.
  the narrower option is preselected on Enter. Every day, the user picks the
  wider option by hand. Preselecting the wider option is one fewer
  keystroke and the audit trail still records exactly what was granted.

## Decision

### `src/ui/ask-flow.ts`

- `MainOpts.sessionLabel` lets the caller name what a session grant covers.
- `askRememberFile` reorders to **folder-cwd, file-cwd, folder-global,
  file-global**; `null`/unsafe folders keep the old 2-option shape.
- New: `parentDomainWildcard(host)` returns `*.parent-domain` for 3+ part
  hosts, and the exact host for 2-part hosts (`example.com` → no useful
  wildcard).
- `askRememberHost` now returns `{ scope, pattern }` instead of `{ scope }`.
  For 3+ part hosts it offers **wildcard-cwd, exact-cwd, wildcard-global,
  exact-global** (4 options). For 2-part hosts, 2 options (the exact host).
- `HostGrant` type added; `parentDomainWildcard` exported for L1 to compute the
  session pattern.

### `src/ui/ask.ts`

- `askDecision` passes a session label that names the grant: `Allow this
  folder for this session` (file/write/read) or `Allow this host group for
  this session` (network).
- `detailLines` shows the folder / wildcard inline under the subject so the
  user understands the consequence of Enter.

### `src/l1-sandbox/network-ask.ts`

- The network decide path stops calling `askDecision` (which would
  double-prompt on the remember branch) and uses `askMain` + `askRememberHost`
  directly.
- Session grants now store the parent-domain wildcard for 3+ part hosts;
  for 2-part hosts the exact host is stored.
- Remember grants persist `picked.pattern` (the wildcard or exact host the
  user picked on screen 2) and `applyNetworkGrant` it live.
- Audit gains a `requested` field so a single audit entry shows both the
  concrete host that triggered the prompt and the pattern that was granted.

### `src/l2-guard/prompts.ts`

- Session grants now store `dirname(overrideValue)` for files, falling back
  to the exact path when `isSafeFolderGrant` rejects the parent (root, home).
- Domain session grants are not stored at Layer 2 — Layer 1 owns them.

### Timer

`ASK_TIMEOUT_BY_ACTION` constant is exposed (`read: 15s`, `write: 10s`,
`network: 30s`, `remember: 60s`). The L1 network ask uses `ASK_TIMEOUT_MS`
today — wiring the per-action config into `askMain` is a follow-up so this
change stays minimal. `0` means no countdown.

## Consequences

- One CLI invocation no longer prompts for sibling files under the same
  folder. Session grants in the user's first interaction cover the whole
  folder.
- One connection to a vendor covers all sibling subdomains under that vendor's
  parent domain (`*.composio.dev`).
- The audit log shows the actual pattern granted (with `requested: <host>` for
  network) so the operator can see the difference between the host that
  prompted and the pattern that was allowed.
- The user still has the exact-host / exact-file option on screen 2 — the
  wider option is just the default.
- `deniedDomains` / `denyRead` / `denyWrite` / absolute-deny tier behavior is
  unchanged. `isSafeFolderGrant` still refuses `/`, home, and parents of home
  for session grants.
- A consequence of the `pickPattern` capture in `askRememberHost` is that
  callers MUST read `pattern` (not invent one). `network-ask.ts` passes it to
  `persist`, `applyLive`, and the audit.
- A 2-part host still gets a single exact-host session grant — `*.example.com`
  wouldn't match the apex, so the wildcard would silently never apply.
- `askRememberFile`'s folder-first ordering changes which option Enter selects.
  Tests for both layers were updated; the change is observable in the audit
  (`granularity: "folder"`).

## Follow-ups not in this PR

- Wire `ask.timeoutMs` into the policy file (sandbox.json) so the user can
  set `0` (no countdown) per action type.
- Detect activity via `onTerminalInput` and re-issue `askSelect` with a fresh
  timer when arrow keys land.
- (Deferred, not in this PR.) Program-level trust: detect the binary in the
  bash command, infer its surface, persist a `trustedPrograms.<id>` entry.
  This was the user's first ask and is a larger change; ADR-030 is the
  minimal step toward it.