# Security — current state

> **Auto-generated** by `security/render.mjs` from `security/manifest.json`. Do not edit by hand. Run `./security/check.sh` after changing the manifest or any source file.

Generated: 2026-10-10T20:06:56.050Z

## At a glance

| Layer | Status | Source files | Tests |
|---|---|---|---|
| **L1** Bash sandbox (sandbox-exec) | ✅ shipped | `extensions/sandbox.ts`<br>`src/l1-sandbox/`<br>`src/core/`<br>`src/shared/`<br>`~/.pi/agent/extensions/sandbox.json` | `L1-attribution`, `L1-outside-fence`, `L1-ask-commands`, `L1-session-grants`, `L1-network-ask`, `L1-L2-network-grants`, `L1-e2e` |
| **L2** In-process tool guard | ✅ shipped | `extensions/guard.ts`<br>`extensions/permission-mode.ts`<br>`src/l2-guard/`<br>`src/detect/`<br>`src/core/`<br>`src/shared/` | `L2-paths`, `L2-urls`, `L2-url-deny`, `L2-symlink`, `L2-grep-filter`, `L2-user-named`, `L2-mcp-gate`, `L1-L2-project-trust`, `L1-L2-override-store`, `L2-ask-contract`, `L1-L2-ask-flow`, `L1-L2-ask-selector`, `L1-L2-defaults`, `L2-detect-smoke`, `L1-L2-permission-mode`, `L1-L2-permission-mode-sync`, `L1-L2-yolo-toggle`, `L2-exposure`, `L1-L2-ask-read` |
| **L3** Subagent posture | 🟢 shipped-opt-in | ❌ `security-guard.ts` | `L3-manual` |
| **L4** Browser gate (chrome_devtools_*) | ⬜ not-started | — | — |

## UX polish

| ID | Status | What |
|---|---|---|
| `UX-hint-merged-streams` | ✅ shipped | src/l1-sandbox/bash-ops.ts scans merged stdout+stderr for EPERM/EACCES/EROFS/"read-only file system", so `cmd 2>&1 | head` still triggers the hint. |
| `UX-write-prompt-errno` | ✅ shipped | Layer 1 attributes the refused path from errno-style output (`EROFS: read-only file system, open '/path'`, `cannot touch '/path': Read-only file system`) and routes a Linux EROFS write to the write prompt; a failed write is never mistaken for an outside-project read, so it cannot offer a useless read grant (ADR-022). |
| `UX-hint-config-dirs` | ✅ shipped | Hint extracts the offending path and recognizes tool config dirs (~/.config/, ~/.kube/, ~/.docker/, ~/.netrc, ~/.aws/, ~/.npmrc, ~/.gitconfig). Suggests a project-local .pi/sandbox.json snippet with the path pre-filled. Says explicitly 'this is the pi sandbox, NOT macOS TCC' so the model stops misdiagnosing. |
| `UX-confirm-retry` | ⬜ not-started | Ask-tier UX: when sandbox blocks AND ctx.hasUI, prompt 'Retry without sandbox? [y/N/always-for-this-cwd]'. 'always' writes path into <cwd>/.pi/sandbox.json. Avoids per-command-prompt antipattern. |

## Layer detail

### L1 — Bash sandbox (sandbox-exec)  ✅ shipped

Sandbox the bash tool's child processes via macOS sandbox-exec. Blocks writes outside allowWrite, blocks reads of denyRead, restricts network to allowedDomains. A host in neither allowedDomains nor deniedDomains asks through the shared ask-tier prompt (ADR-023, ADR-024) — `Allow (default)` / `Deny` / `Allow for this session` / `Allow and remember…`; an unanswered countdown counts as Allow once, Esc denies; prompts are serialized so pi never shows two at once (overlapping selects orphan each other and hang the awaited proxy request). "once" covers the bash command, "remember" writes overrides.allowDomains (applied live, without restarting the proxy); headless denies. `deniedDomains` is a hard deny the prompt cannot override. When filesystem.outsideProject.read gates reads, a pre-flight ask (ADR-015) confirms plainly-named outside reads before the command runs — undetected reads still fall back to the home fence and re-exposed allowRead roots (ADR-014). A refused write is attributed from the error output (EPERM on macOS, EROFS/"read-only file system" on Linux) and offered through the write prompt (ADR-021); a failed write is never offered as a read grant (ADR-022). Filesystem asks offer once / session / remember: a session grant lives in memory, covers the folder (the exact path when the parent is unsafe to grant) and is cleared at session_start. The filesystem block is rebuilt from a fresh sandbox.json for every command (ADR-033), so a remember from either layer — or a hand edit — applies to the next bash call without a reload; the network section stays live via updateConfig.

**Source files**

- ✓ `extensions/sandbox.ts` — 242 lines, mtime 2026-10-10
- ✓ `src/l1-sandbox/` — dir, mtime 2026-10-10
- ✓ `src/core/` — dir, mtime 2026-10-10
- ✓ `src/shared/` — dir, mtime 2026-10-08
- ✓ `~/.pi/agent/extensions/sandbox.json` — 4 lines, mtime 2026-10-10

**Tests**

- `L1-attribution` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/l1-attribution.mjs` → expects PASS=41, FAIL=0
- `L1-outside-fence` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/outside-fence.mjs` → expects PASS=38, FAIL=0
- `L1-ask-commands` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/ask-commands.mjs` → expects PASS=11, FAIL=0
- `L1-session-grants` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/l1-session-grants.mjs` → expects PASS=25, FAIL=0
- `L1-network-ask` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/network-ask.mjs` → expects PASS=45, FAIL=0
- `L1-L2-network-grants` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/network-grants.mjs` → expects PASS=6, FAIL=0
- `L1-e2e` — `APS_E2E=1 node --import ./security/tests/ts-loader.mjs security/tests/e2e/sandbox-fs.mjs` → expects manual — run with APS_E2E=1 (needs bwrap/socat; initialize can be slow)

**Known gaps / accepted risks**

- Raw-IP egress bypasses domain allowlist (sandbox-runtime matches by hostname only) — XFAIL, accepted v1 risk
- The network ask callback receives only host:port, not command identity; an 'Allow once' grant is scoped to the bash invocation in flight and can briefly cover a concurrent user_bash command to the same host
- An extension prompt can still be replaced by a pi-internal selector (trust, model picker); the prompt queue serializes only this extension's asks
- Esc and countdown expiry both surface as `undefined` from pi's select; in RPC they are distinguished by elapsed time (ADR-024), while the TUI custom selector records expiry exactly (ADR-031)
- Pre-flight ask (ADR-015) path detection is heuristic: obfuscated reads (variable expansion, nested shells, scripts) are not prompted and stay masked by the OS fence
- askRead (ADR-019) pre-flight is heuristic too: an obfuscated read of an askRead path is not prompted (put the path in denyRead to hard-deny it)
- Write attribution is post-hoc (ADR-021): the command has already failed when the prompt appears, and a command whose output never names the operand cannot be attributed

### L2 — In-process tool guard  ✅ shipped

Catch what sandbox-exec can't: the in-process read/grep/find/ls/write/edit/fetch_content/web_search/get_search_content tools. Same policy file as L1. grep output lines from denied files beneath an allowed search root are removed before they reach the model (ADR-008). Denied domains are a hard block, never ask-able (ADR-023); an unknown domain asks with once/session/remember. In Advanced Secure mode (ADR-018) it also flags sensitive filenames and risky MCP tool calls before they run, and redacts detected secrets from any tool output before it reaches the model. The MCP gate ignores the server namespace, classifies from the head verb of the name or description, asks for destructive names/arguments and mutating names, and fails closed only for tools with no description; `sandbox.json` -> `mcp` tunes it (allow/ask lists, annotation trust, threshold) per ADR-032.

**Source files**

- ✓ `extensions/guard.ts` — 446 lines, mtime 2026-10-09
- ✓ `extensions/permission-mode.ts` — 134 lines, mtime 2026-10-09
- ✓ `src/l2-guard/` — dir, mtime 2026-10-08
- ✓ `src/detect/` — dir, mtime 2026-10-07
- ✓ `src/core/` — dir, mtime 2026-10-10
- ✓ `src/shared/` — dir, mtime 2026-10-08

**Tests**

- `L2-paths` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/path-matcher.mjs` → expects PASS=13, FAIL=0
- `L2-urls` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/url-allowlist.mjs` → expects PASS=8, FAIL=0
- `L2-url-deny` — `node --import ./security/tests/ts-loader.mjs security/tests/contract/url-gate.mjs` → expects PASS=12, FAIL=0
- `L2-symlink` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/symlink-escape.mjs` → expects PASS=5, FAIL=0
- `L2-grep-filter` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/grep-filter.mjs` → expects PASS=15, FAIL=0
- `L2-user-named` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/user-named.mjs` → expects PASS=16, FAIL=0
- `L2-mcp-gate` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/mcp-gate.mjs` → expects PASS=39, FAIL=0
- `L1-L2-project-trust` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/project-trust.mjs` → expects PASS=57, FAIL=0
- `L1-L2-override-store` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/override-store.mjs` → expects PASS=18, FAIL=0
- `L2-ask-contract` — `node --import ./security/tests/ts-loader.mjs security/tests/contract/ask.mjs` → expects PASS=31, FAIL=0
- `L1-L2-ask-flow` — `node --import ./security/tests/ts-loader.mjs security/tests/contract/ask-flow.mjs` → expects PASS=55, FAIL=0
- `L1-L2-ask-selector` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/ask-selector.mjs` → expects PASS=20 FAIL=0
- `L1-L2-defaults` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/default-policy.mjs` → expects PASS=16, FAIL=0
- `L2-detect-smoke` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/detect-smoke.mjs` → expects PASS=26, FAIL=0
- `L1-L2-permission-mode` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/permission-mode.mjs` → expects PASS=23, FAIL=0
- `L1-L2-permission-mode-sync` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/permission-mode-yolo-sync.mjs` → expects PASS=4, FAIL=0
- `L1-L2-yolo-toggle` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/yolo.mjs` → expects PASS=16, FAIL=0
- `L2-exposure` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/exposure.mjs` → expects PASS=15, FAIL=0
- `L1-L2-ask-read` — `node --import ./security/tests/ts-loader.mjs security/tests/unit/ask-read.mjs` → expects PASS=13, FAIL=0

**Known gaps / accepted risks**

- Live end-to-end tests via the actual tools are manual today (no in-session test harness in pi yet)
- fetch_content redirects are not re-checked against the allowlist
- web_search itself is not domain-checked (only its follow-on fetch_content is)
- find and ls still print names (not contents) of denied files beneath an allowed root (ADR-008, accepted)
- The grep output filter parses pi's grep line format; a format change leaves lines unfiltered until grep-filter.mjs is updated
- MCP gate heuristics read tool names and description heads; a server that only states its operation in prose deeper in the description (or that omits descriptions entirely) may still ask — tune it with the `mcp` policy lists (ADR-032)

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

- Global: `~/.pi/agent/extensions/sandbox.json` — 4 lines, mtime 2026-10-10
- Project override: `<cwd>/.pi/sandbox.json` (per-cwd; merges over global)
- Escape hatch: `--yolo (all layers off for this run) or /permission-mode → YOLO (all layers off; persisted as mode="yolo" in the global sandbox.json)`

## Where to find things

| File | Role |
|---|---|
| `SECURITY.md` | Auto-generated current-state overview. DO NOT EDIT — regenerated by security/check.sh. |
| `SECURITY_PLAN.md` | Long-form intent / threat model / acceptance criteria. Hand-edited. |
| `docs/security/implementation.md` | Deep-dive: configs, code patches, setup commands. Hand-edited. |
| `docs/security/tradeoffs.md` | Decision log: why this design, what we accepted as v1 risk. Hand-edited. |
| `docs/security/testing.md` | Layer-by-layer test matrix + manual-test recipes. Hand-edited. |
| `security/manifest.json` | THE source of truth for layer status. Edit this when a layer changes. |
