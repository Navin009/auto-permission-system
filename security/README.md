# security/ — single source of truth

```
security/
├── manifest.json     ← THE source of truth. Edit when a layer changes.
├── render.mjs        ← reads manifest, writes ../SECURITY.md
├── check.sh          ← runs all tests + render. THE only command you need.
└── tests/
    ├── ts-loader.mjs       ← registers the extensionless-import resolver for Node
    ├── ts-hooks.mjs        ← the resolver hook itself
    └── unit/               ← pure-core tests, run against src/core/
```

## Workflow

When you change anything security-related:

1. Edit the source (e.g. `~/.pi/agent/extensions/security-guard.ts`, or `sandbox.json`).
2. Update `manifest.json` if status / files / tests changed.
3. Run `./security/check.sh`.
4. If green, commit. `SECURITY.md` is regenerated and shows the new state.

`SECURITY.md` lives at the repo root and is **always in sync** with the manifest — it's overwritten by every `check.sh` run. Don't edit it.

## Adding a test

Drop a runnable script in `security/tests/unit/` that imports the pure logic from `src/core/` and prints `PASS=N FAIL=M` and `exit 1` on failure. Register it in the relevant layer's `tests` array in `manifest.json` as `node --import ./security/tests/ts-loader.mjs security/tests/unit/<file>.mjs` (the loader lets Node follow the sources' extensionless imports). Re-run `check.sh` and it picks up the new test automatically.

## Adding a new layer

Append an object to `manifest.layers[]` with at minimum `id`, `name`, `status`, `purpose`, `sourceFiles`, `tests`, `knownGaps`. Optionally add `config` for opt-in policy knobs.

## Why this exists

Before this directory the security state lived across:

- `SECURITY_PLAN.md` (intent + checkboxes)
- `docs/security/implementation.md` (deep-dive)
- `docs/security/tradeoffs.md` (decisions)
- `docs/security/testing.md` (test matrix)
- `~/.pi-tmp/*.mjs` (ephemeral test files — would have been lost)
- `~/.pi/agent/extensions/sandbox.json` (actual policy)
- `~/.pi/agent/extensions/security-guard.ts` (actual code)

Easy for them to drift. Now there's exactly one file that says "this is what's shipped" and one command that proves it.
