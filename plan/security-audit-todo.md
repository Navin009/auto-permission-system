# Security audit — working order

**Status:** open. Working list for `plan/security-audit.md` (every ID below is defined there).

**One line:** nine batches, ordered so the pipeline and the deny semantics are correct before
anything is renamed or merged — each item is one commit with its test.

---

## Rules for every item

1. Every finding lands **with its test** (named in the audit doc) and the test entry added to
   `security/manifest.json` in the same commit, so `./security/check.sh` regenerates `SECURITY.md`
   with it.
2. Conventional Commits; `fix:`/`feat:` when the release note matters, `refactor:`/`docs:`/
   `chore:` when it does not. The reasoning goes in the commit body (repo convention) and, when a
   layer semantic changes, in `security/manifest.json` as well.
3. A fixed finding is marked `✅ <commit>` in the audit doc; the finding text is never deleted —
   the "why" is the useful part.
4. `npm run typecheck && npm test` green after every item. Batch 0 adds a single `npm run check`
   that does both.
5. One item = one reviewable diff. If an item needs two commits (mechanical move + behaviour), say
   so in the checklist line.

---

## Batch 0 — foundations (no behaviour change)

Do these first: the formatter makes every later diff readable, and the check script makes the rest
verifiable. Each is an isolated commit.

- [ ] **C2** — add a formatter (tabs, to match the 84 files), run it once as its own
      `style:` commit, add `format`/`lint` scripts and a CI step. Expect ~25 files to change
      whitespace only; no logic may move in this commit.
- [ ] **T1** — `engines: { node: ">=22.19.0" }` (pi's own floor, verified in its package.json) + `.nvmrc` (`24`).
- [ ] **T2** — `"check": "npm run typecheck && npm test && ./security/check.sh"`; use it in
      `ci.yml` and `release-tag.yml`.
- [ ] **T3** — decide and do: assert the manifest `expected` counts in `check.sh`, or drop the
      field from the manifest + `render.mjs`. (Recommendation: assert — it turns `SECURITY.md`
      into a contract.) Also warn about the 20 test files the manifest does not list (36 entries
      vs 54 files, mostly the display-only `tool-view-*` suite).

## Batch 1 — quick hardening (one-liners, no design risk)

- [ ] **S4** — `chmodSync(sockPath, 0o600)` in `startHostPortBridge`; move both bridges into
      `/tmp/pi-<uid>/` (`0700`). Test: `L1-bridge-perms`.
- [ ] **S7** — `fileHash` returns `null` for a non-file; wrap the `loadConfig`/`loadPolicy` calls in
      `session_start`. Test: `L1-L2-policy-dir`.
- [ ] **S8** — `isAbsolute(printed) ? printed : join(searchRoot, printed)`. Test: extend
      `L2-grep-filter` with absolute paths.
- [ ] **S14** — add `askWrite` to `ADDITIVE_DENY_KEYS`. Test: extend `L1-L2-project-trust`.
- [ ] **B7** — `Buffer.byteLength` for string leaves in `estimateSize`. Test: `L2-detect-size`.
- [ ] **C11** — `path-matcher.mjs` imports the shipped `matchPattern`; delete the local copies.
      Case rows will fail until S15 — expected, keep them as `XFAIL`-style labelled cases.

## Batch 2 — one matcher, then deny semantics

Order matters: C1 decides where the semantics live, S1/S15 change them, S2 changes what a deny
means. One commit each.

- [ ] **C1** — move the matcher into `src/core/policy/`, re-export from `matching.ts`, delete the
      duplicate. Test: `L1-L2-path-parity` (both entry points, one table).
- [ ] **S1** — move the `overrides.allowRead`/`allowWrite` checks below the deny loops. Test:
      `L2-deny-precedence`. **Update ADR-047 text** to match the final order.
- [ ] **S15** — basename globs case-insensitive on every platform; full-path prefixes stay
      case-sensitive on Linux. Test: `L2-path-case`.
- [ ] **S2** — decide the contract (terminal `denyRead`, or a `hardDeny` pair) and implement it +
      the docs. Test: `L2-deny-terminal`. Needs a manifest `knownGaps`/purpose edit.

**Stop here and write a release note**: S1 + S2 + S15 change what a `denyRead` entry means. That is
a `feat!:` at minimum, and the README/SKILL.md deny tables must be re-read against the new order.

## Batch 3 — close the fail-open paths

- [ ] **B1** — arm `beginNetworkCommand`/`endNetworkCommand` around `attemptExecution` in
      `bash-ops.ts`. Test: `L1-network-once`. (Highest value per line in this whole list: the logic
      and 45 tests already exist, only the wiring is missing.)
- [ ] **S3** — on `startSandbox` failure (and on `enabled: false`), register a `tool_call` +
      `user_bash` block for bash with a clear reason; `--yolo` stays the only bypass. Test:
      `L1-fail-closed`. Status chip must say `Sandbox: unavailable` rather than nothing.
- [ ] **S5** — deny on network prompt expiry; optional `network.allowOnTimeout` (default `false`).
      Test: `L1-network-timeout`. Update ADR-024/030 text.
- [ ] **S13** — ask/block when a URL tool yields zero URLs; audit the raw input keys. Test:
      `L2-url-unparsed`. Confirm the real `fetch_content` schema first.

## Batch 4 — state and lifecycle

- [ ] **B2** — `currentWorkingDirectory` from `context.cwd`, replacing `initialWorkingDirectory`
      everywhere it is used. Test: `L1-cwd-source`.
- [ ] **S11** — atomic policy writes (temp + `fsync` + rename + re-parse) and one in-process lock
      shared by both layers. Test: `L1-L2-policy-write`.
- [ ] **B3** — `/permission-mode` reports a project `mode` override and writes the project file
      when trusted. Test: extend `L1-L2-permission-mode`.
- [ ] **B4** — wire `ASK_TIMEOUT_BY_ACTION` or delete it; fix ADR-030 either way. Test: extend
      `L1-L2-ask-selector`.
- [ ] **B5** — `askQueued()` exported from `ask-flow.ts`; use it for the trust dialog and the mode
      picker. Test: `L1-L2-ask-queue`.
- [ ] **B6** — clear the status chip on disable/stop; clear `latestBashCommand` on `tool_result`;
      tail-read `audit.log` in `/security`. Test: `L1-L2-status-chip`.

## Batch 5 — detection and logging

- [ ] **S6** — assert the runtime arrays before/after mutation; report failure once (`console.error`
      + audit) instead of swallowing. Extend `L1-ghost-dotfiles`.
- [ ] **S9** — require a path-shaped token for the silent outside-project grant. Extend
      `L2-user-named`.
- [ ] **S10** — validate and audit live domain grants (reject `*`, malformed, and `deniedDomains`);
      make yolo config/flag-authoritative, the event announcement-only. Test:
      `L1-L2-grant-channel`.
- [ ] **S12** — audit file `0600`, rotation, one-shot error report. Test: `L2-audit-log`.
- [ ] **C7** — mtime-keyed policy cache; one `loadPolicy` per event shared by the two `tool_result`
      handlers. Test: `L1-L2-policy-cache`.

## Batch 6 — simplification (behaviour must not change)

These are the "no functional diff" batch: every existing test must stay green **unchanged**.

- [ ] **C3** — one `src/shared/policy-layer.ts`; delete the L1/L2 copies.
- [ ] **C4** — one `askNetworkGrant()` for both layers; one `pickOption()` for the three remember
      screens. Add one case asserting L1 and L2 print identical text for the same host.
- [ ] **C5** — one core `commandHeadName()`; both call sites use it.
- [ ] **C6** — replace `export *` in `src/core/index.ts` with named re-exports.
- [ ] **C8** — `MAXIMUM_RETRIES` in `bash-recovery.ts`; table-driven tails in `target-summary.ts`.
- [ ] **C9** — `src/shared/messages.ts` for the user-facing prefixes.
- [ ] **C10** — `knip` pass, prune dead exports, wire `npm run audit` (or delete the two scripts).

## Batch 7 — process and validation

- [ ] **T4** — `sandbox.schema.json`; validate the three shipped presets in the test suite; add an
      unknown-key report to the loaders (notify + audit, never throw). This catches the
      `strictAllowlst` class of support issue.
- [ ] **T5** — scheduled e2e job (`bubblewrap` + `socat` on `ubuntu-latest`) for `L1-e2e`.

## Batch 8 — features (only after 0–7)

- [ ] **F1** — `/security explain <path|url>`.
- [ ] **F2** — session-grant visibility (network + output) and `/security reset`.
- [ ] **F3** — `--security-dry-run`.
- [ ] **F4** — fail-closed bash fallback at L2 (S3's other half).
- [ ] **F5** — L4 browser gate for `chrome_devtools_*`.
- [ ] **F6** — `security-report` (denials per layer, most-prompted paths, rules that never fired).

---

## Progress

| Batch | Items | Done |
| --- | --- | --- |
| 0 foundations | 4 | 0 |
| 1 quick hardening | 6 | 0 |
| 2 one matcher + deny | 4 | 0 |
| 3 fail-open | 4 | 0 |
| 4 state/lifecycle | 6 | 0 |
| 5 detection/logging | 5 | 0 |
| 6 simplification | 7 | 0 |
| 7 process | 2 | 0 |
| 8 features | 6 | 0 |
| **total** | **44** | **0** |

## Suggested commit sequence for the first session

```text
style(format): one formatter, tabs everywhere, CI gate            # C2
chore(npm): declare node >=20.11 and add an aggregate check       # T1, T2
fix(sandbox): keep bridge sockets owner-only                      # S4
fix(trust): treat a policy path that is not a file as untrusted    # S7
fix(guard): filter grep lines that print an absolute path          # S8
fix(trust): let an untrusted project add askWrite rules            # S14
test(paths): import the shipped matcher instead of copying it      # C11
```
