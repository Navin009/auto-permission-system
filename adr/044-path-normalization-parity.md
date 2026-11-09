# ADR-044: One path spelling for both layers

**Status:** Accepted

## Context

Layer 2 matched policy patterns against `resolve(cwd, rawPath)`. pi's own tools
resolve the path **before** opening it, and their resolver is not plain
`resolve`:

- `~` / `~/x` expand to `$HOME` (`normalizePath`)
- a leading `@` is stripped
- `file://` URLs become filesystem paths
- Unicode spaces fold to a normal space

So the guard inspected a path that does not exist while the tool opened the real
one:

| spelled | guard inspected | pi opened |
|---|---|---|
| `read ~/.ssh/id_rsa` | `<cwd>/~/.ssh/id_rsa` | `/home/u/.ssh/id_rsa` |
| `read ~/.aws/config` | `<cwd>/~/.aws/config` | `/home/u/.aws/config` |
| `read file:///home/u/.ssh/id_rsa` | `<cwd>/file:/home/u/.ssh/id_rsa` | `/home/u/.ssh/id_rsa` |
| `read @/etc/passwd` | `<cwd>/@/etc/passwd` | `/etc/passwd` |

Every `~/…` rule (including the absolute-deny tier) was reachable by writing
`~` and letting the tool expand it. `write ~/.bashrc` passed `allowWrite: ["."]`
the same way, so a `write` tool call could plant a shell startup file without a
prompt. Layer 1 had the same hole in its own spelling: `askReadCandidates`
compared tokens against the pattern spelling without normalising.

## Decision

- **One implementation:** `src/core/policy/user-path.ts` →
  `normalizeUserPath()` (fold spaces, strip one `@`, `file://` → path, expand
  `~` / `~/`). It lives in `core` so both layers and both adapters use it.
- **`canonicalize()` normalises first**, then resolves and walks `realpath`.
  Everything that matches a policy pattern goes through it, so a rule matches
  what the tool will actually open.
- **Layer 1 candidate tokens are normalised too** (`fence.ts`,
  `resolveTokenPaths`), and `matching.expandHome()` delegates to the same
  function instead of keeping a second copy.
- **The `@` strip mirrors pi on purpose**, even though bash treats `@` literally:
  parity is what closes the bypass, and a file whose name really starts with `@`
  is still reachable as `./@name`.

## Consequences

- `read ~/.ssh/id_rsa`, `read file:///…/id_rsa` and `read @/etc/passwd` are
  denied with the same reason as their absolute spelling. `write ~/.bashrc`
  needs permission (it is outside `allowWrite`), and `write ~/.ssh/…` is
  absolute-denied.
- A future change to pi's resolver can re-open the hole. The invariant is
  covered by `security/tests/unit/user-path.mjs`: every spelling of one real file
  must canonicalize to one path, and `~` must not be anchored at `cwd`.
- Relative spellings keep working: `src/app.ts`, `./x`, `../x` are unchanged.
