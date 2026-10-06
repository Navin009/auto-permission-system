# Security — current state

> **Auto-generated** by `security/render.mjs` from `security/manifest.json`. Do not edit by hand. Run `./security/check.sh` after changing the manifest or any source file.

Generated: 2026-10-06T19:45:59.064Z

## At a glance

| Layer | Status | Source files | Tests |
|---|---|---|---|
| **L1** Bash sandbox (sandbox-exec) | ✅ shipped | `extensions/sandbox.ts`<br>`src/l1-sandbox/`<br>`src/core/`<br>❌ `~/.pi/agent/extensions/sandbox.json` | `L1-attribution`, `L1-outside-fence`, `L1-e2e` |
| **L2** In-process tool guard | ✅ shipped | `extensions/guard.ts`<br>`src/l2-guard/`<br>`src/core/` | `L2-paths`, `L2-urls`, `L2-symlink`, `L2-grep-filter`, `L2-user-named`, `L1-L2-project-trust`, `L2-ask-contract`, `L1-L2-ask-flow`, `L1-L2-defaults` |
| **L3** Subagent posture | 🟢 shipped-opt-in | ❌ `security-guard.ts` | `L3-manual` |
| **L4** Browser gate (chrome_devtools_*) | ⬜ not-started | — | — |

## UX polish

| ID | Status | What |
|---|---|---|
| `UX-hint-merged-streams` | ✅ shipped | sandbox/index.ts now scans merged stdout+stderr for EPERM/EACCES, so `cmd 2>&1 | head` still triggers the hint. |
| `UX-hint-config-dirs` | ✅ shipped | Hint extracts the offending path and recognizes tool config dirs (~/.config/, ~/.kube/, ~/.docker/, ~/.netrc, ~/.aws/, ~/.npmrc, ~/.gitconfig). Suggests a project-local .pi/sandbox.json snippet with the path pre-filled. Says explicitly 'this is the pi sandbox, NOT macOS TCC' so the model stops misdiagnosing. |
| `UX-confirm-retry` | ⬜ not-started | Ask-tier UX: when sandbox blocks AND ctx.hasUI, prompt 'Retry without sandbox? [y/N/always-for-this-cwd]'. 'always' writes path into <cwd>/.pi/sandbox.json. Avoids per-command-prompt antipattern. |

## Layer detail

### L1 — Bash sandbox (sandbox-exec)  ✅ shipped

Sandbox the bash tool's child processes via macOS sandbox-exec. Blocks writes outside allowWrite, blocks reads of denyRead, restricts network to allowedDomains. When filesystem.outsideProject.read gates reads, a pre-flight ask (ADR-015) confirms plainly-named outside reads before the command runs — undetected reads still fall back to the home fence and re-exposed allowRead roots (ADR-014).

**Source files**

- ✓ `extensions/sandbox.ts` — 186 lines, mtime 2026-10-06
- ✓ `src/l1-sandbox/` — dir, mtime 2026-10-06
- ✓ `src/core/` — dir, mtime 2026-10-06
- ❌ `~/.pi/agent/extensions/sandbox.json` — MISSING

**Tests**

- `L1-attribution` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/l1-attribution.mjs` → expects PASS=29, FAIL=0
- `L1-outside-fence` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/outside-fence.mjs` → expects PASS=38, FAIL=0
- `L1-e2e` — `APS_E2E=1 node security/tests/e2e/sandbox-fs.mjs` → expects manual — run with APS_E2E=1 (needs bwrap/socat; initialize can be slow)

**Known gaps / accepted risks**

- Raw-IP egress bypasses domain allowlist (sandbox-runtime matches by hostname only) — XFAIL, accepted v1 risk
- Pre-flight ask (ADR-015) path detection is heuristic: obfuscated reads (variable expansion, nested shells, scripts) are not prompted and stay masked by the OS fence

### L2 — In-process tool guard  ✅ shipped

Catch what sandbox-exec can't: the in-process read/grep/find/ls/write/edit/fetch_content/web_search/get_search_content tools. Same policy file as L1. grep output lines from denied files beneath an allowed search root are removed before they reach the model (ADR-008).

**Source files**

- ✓ `extensions/guard.ts` — 283 lines, mtime 2026-10-06
- ✓ `src/l2-guard/` — dir, mtime 2026-10-06
- ✓ `src/core/` — dir, mtime 2026-10-06

**Tests**

- `L2-paths` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/path-matcher.mjs` → expects PASS=13, FAIL=0
- `L2-urls` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/url-allowlist.mjs` → expects PASS=8, FAIL=0
- `L2-symlink` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/symlink-escape.mjs` → expects PASS=5, FAIL=0
- `L2-grep-filter` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/grep-filter.mjs` → expects PASS=15, FAIL=0
- `L2-user-named` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/user-named.mjs` → expects PASS=16, FAIL=0
- `L1-L2-project-trust` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/project-trust.mjs` → expects PASS=41, FAIL=0
- `L2-ask-contract` — `node --import ./security/tests/ts-loader.mjs security/tests/contract/ask.mjs` → expects PASS=24, FAIL=0
- `L1-L2-ask-flow` — `node --import ./security/tests/ts-loader.mjs security/tests/contract/ask-flow.mjs` → expects PASS=20, FAIL=0
- `L1-L2-defaults` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/default-policy.mjs` → expects PASS=13, FAIL=0

**Known gaps / accepted risks**

- Live end-to-end tests via the actual tools are manual today (no in-session test harness in pi yet)
- fetch_content redirects are not re-checked against the allowlist
- find and ls still print names (not contents) of denied files beneath an allowed root (ADR-008, accepted)
- The grep output filter parses pi's grep line format; a format change leaves lines unfiltered until grep-filter.mjs is updated

### L3 — Subagent posture  🟢 shipped-opt-in

Stricter network policy when ctx.hasUI === false (subagents, -p mode, JSON mode). Filesystem deny rules apply unchanged in every context.

**Source files**

- ❌ `security-guard.ts` — MISSING

**Config**

- Key: `subagent.network`
- Values: `allow (default)`, `deny`, `research-only`
- Default: `allow`
- Note: research-only uses a transcript heuristic to identify librarian/scout/researcher agents. Best-effort; v2 should plumb agent identity through ctx.

**Tests**

- `L3-manual` — `echo 'manual: set subagent.network=deny in sandbox.json, run pi -p "fetch https://example.com"; expect block'` → expects manual

**Known gaps / accepted risks**

- ctx.hasUI=false also catches legitimate scripted runs, not just subagents — that's why default is 'allow'
- No first-class agent identity in ctx

### L4 — Browser gate (chrome_devtools_*)  ⬜ not-started

Per-session ctx.ui.confirm for mutating chrome_devtools_* tools (navigate_page, click, fill, evaluate_script, etc.). Read-only ops (snapshot, screenshot) stay open. Subagents always denied.

**Known gaps / accepted risks**

- entire layer not implemented

## Policy files

- Global: `~/.pi/agent/extensions/sandbox.json` — MISSING
- Project override: `<cwd>/.pi/sandbox.json` (per-cwd; merges over global)
- Escape hatch: `--yolo (disables ALL layers globally)`

## Where to find things

| File | Role |
|---|---|
| `SECURITY.md` | Auto-generated current-state overview. DO NOT EDIT — regenerated by security/check.sh. |
| `SECURITY_PLAN.md` | Long-form intent / threat model / acceptance criteria. Hand-edited. |
| `docs/security/implementation.md` | Deep-dive: configs, code patches, setup commands. Hand-edited. |
| `docs/security/tradeoffs.md` | Decision log: why this design, what we accepted as v1 risk. Hand-edited. |
| `docs/security/testing.md` | Layer-by-layer test matrix + manual-test recipes. Hand-edited. |
| `security/manifest.json` | THE source of truth for layer status. Edit this when a layer changes. |
