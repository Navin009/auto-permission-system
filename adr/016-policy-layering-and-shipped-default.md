# ADR-016: A shipped default policy is layer 0; explicit, shared layering

**Status:** Accepted

## Context

The only strong policy most users had was their hand-written
`~/.pi/agent/extensions/sandbox.json`. When that file is absent the code falls
back to hardcoded constants that are much weaker than the file users actually
run:

- `filesystem.outsideProject` was **absent**, so `outsideProject.read` defaulted
  to `"allow"` — the whole project boundary silently turned off.
- `modelDenyRead` was absent, re-exposing gh/aws/kube/npmrc credentials to the
  model's `read` tool.
- `denyRead` / `denyWrite` were four entries each instead of the ~20 a real
  policy uses.

Renaming the global file therefore *silently lowered* protection: nothing was
broken, but the fallback was weak. Two further problems:

1. The baseline was duplicated in code — `DEFAULT_CONFIG` (Layer 1) and
   `DEFAULT_POLICY` (Layer 2), marked "keep in sync" — so the two could drift.
2. The layering was implicit. Layer 1 had `deepMerge`, Layer 2 had its own inline
   spread loop; both replaced arrays, so a higher layer's `denyRead` wiped the
   lower one's without saying so.

## Decision

- **Ship `sandbox.default.json`** at the package root as the lowest layer. It is
  the secure baseline: `outsideProject.read: "ask"`, the full `denyRead` /
  `denyWrite` / `modelDenyRead` lists, and the expanded network allowlist. It is
  listed in `package.json` `files`.
- **Precedence: shipped default < global (`~/.pi/agent/extensions/sandbox.json`) <
  project (`<cwd>/.pi/sandbox.json`).** A trusted project may loosen (ADR-013);
  an untrusted project may only tighten.
- **One shared merge.** `overlayPolicy()` (`src/core/policy/merge.ts`) is the
  authoritative merge (an object key shallow-merges, `overrides` concatenates,
  any other present key replaces). `applyUntrustedProject()` remains the
  tighten-only merge. Both layers call the same two functions; Layer 1's
  `deepMerge` and Layer 2's inline loop are deleted.
- **One baseline.** `loadDefaultPolicy()` (`src/core/policy/default-file.ts`)
  reads `sandbox.default.json` relative to the package and is layered under the
  built-in constants, which stay as the fallback if the file is missing or
  unparseable. Layer 1 and Layer 2 each build their default from the same call.

## Consequences

- **Install = protected.** Without any user config, `outsideProject.read` is
  `ask`, `modelDenyRead` is populated, and the deny lists are full.
- A user's global file only states what it changes; absent keys keep the shipped
  default. Removing a shipped deny requires naming it in a higher layer (global,
  or a trusted project) — the intentional loosening path.
- `overlayPolicy` replaces arrays where present; to *add* a deny without dropping
  the baseline, a layer should list what it wants, or rely on the untrusted
  tighten path. This matches the "loosening is allowed but explicit" stance.
- `security/tests/unit/default-policy.mjs` locks both the baseline's key fields
  and `overlayPolicy`'s semantics, so deleting the file or changing the merge
  fails CI.
