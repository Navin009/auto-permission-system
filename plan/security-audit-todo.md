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

## Batch 0 — foundations (no behaviour change) — landed

Do these first: the formatter makes every later diff readable, and the check script makes the rest
verifiable. Each is an isolated commit.

- [x] **C2** — `90d935d` — prettier, tabs, `printWidth: 120`, `format`/`format:check` scripts, CI
      gate. 71 files, whitespace only apart from one already-unused import.
- [x] **T1** — `93e58a8` — `engines.node >=22.19.0` (pi's own floor) + `.nvmrc` 24.
- [x] **T2** — `8fb091c` — `npm run check`, used by `ci.yml` and `release-tag.yml`.
- [x] **T3** — `95dc6ab` — `check.sh` asserts the pinned counts and warns about unlisted files; the
      gate caught 8 stale pins and 3 missing L2 output-gate tests on its first run.

## Batch 1 — quick hardening (one-liners, no design risk)

- [x] **S4** — `b393fda` — both bridges and the bash TMPDIR live in `<tmp>/pi-<uid>` (0700), the
      port socket is `0600`, and a symlinked or foreign scratch path throws instead of falling back.
      Test: `L1-bridge-perms` (17).
- [x] **S7** — `6be8652` — `fileHash` requires a regular file; a present-but-unreadable policy path
      is *untrusted* (the naive fix would have made it trusted); loaders skip non-files; both
      `session_start` handlers fail closed. Test: `L1-L2-policy-dir` (17).
- [x] **S8** — `e80177e` — `isAbsolute(printed) ? printed : join(searchRoot, printed)`. Test: extend
      `L2-grep-filter` with absolute paths.
- [x] **S14** — `7d1f9ea` — add `askWrite` to `ADDITIVE_DENY_KEYS`. Test: extend `L1-L2-project-trust`.
- [x] **B7** — `6719c1c` — `Buffer.byteLength` for string leaves in `estimateSize`. Test: `L2-detect-size`.
- [x] **C11** — `8495500` — `path-matcher.mjs` imports the shipped `matchPattern`; delete the local copies.
      Case rows will fail until S15 — expected, keep them as `XFAIL`-style labelled cases.

## Batch 2 — one matcher, then deny semantics

Order matters: C1 decides where the semantics live, S1/S15 change them, S2 changes what a deny
means. One commit each.

- [x] **C1** — `331ac24` — move the matcher into `src/core/policy/`, re-export from `matching.ts`, delete the
      duplicate. Test: `L1-L2-path-parity` (both entry points, one table).
- [x] **S1** — `420798b` — move the `overrides.allowRead`/`allowWrite` checks below the deny loops. Test:
      `L2-deny-precedence`. **Update ADR-047 text** to match the final order.
- [x] **S15** — `8c531bd` — basename globs case-insensitive on every platform; full-path prefixes stay
      case-sensitive on Linux. Test: `L2-path-case`.
- [x] **S2** — `a047b26` — decide the contract (terminal `denyRead`, or a `hardDeny` pair) and implement it +
      the docs. Test: `L2-deny-terminal`. Needs a manifest `knownGaps`/purpose edit.

**Stop here and write a release note**: S1 + S2 + S15 change what a `denyRead` entry means. That is
a `feat!:` at minimum, and the README/SKILL.md deny tables must be re-read against the new order.

## Batch 3 — close the fail-open paths

- [x] **B1** — `0603181` — arm `beginNetworkCommand`/`endNetworkCommand` around `attemptExecution` in
      `bash-ops.ts`. Test: `L1-network-once`. (Highest value per line in this whole list: the logic
      and 45 tests already exist, only the wiring is missing.)
- [x] **S3** — `233840e` — on `startSandbox` failure (and on `enabled: false`), register a `tool_call` +
      `user_bash` block for bash with a clear reason; `--yolo` stays the only bypass. Test:
      `L1-fail-closed`. Status chip must say `Sandbox: unavailable` rather than nothing.
- [x] **S5** — `489a398` — deny on network prompt expiry; optional `network.allowOnTimeout` (default `false`).
      Test: `L1-network-timeout`. Update ADR-024/030 text.
- [x] **S13** — `387eff8` — ask/block when a URL tool yields zero URLs; audit the raw input keys. Test:
      `L2-url-unparsed`. Confirm the real `fetch_content` schema first.

## Batch 4 — state and lifecycle

- [x] **B2** — `9a835b0` — `currentWorkingDirectory` from `context.cwd`, replacing `initialWorkingDirectory`
      everywhere it is used. Test: `L1-cwd-source`.
- [x] **S11** — `c6eb540` — atomic policy writes (temp + `fsync` + rename + re-parse) and one in-process lock
      shared by both layers. Test: `L1-L2-policy-write`.
- [x] **B3** — `8b1e2c4` — `/permission-mode` reports a project `mode` override and writes the project file
      when trusted. Test: extend `L1-L2-permission-mode`.
- [x] **B4** — `520a893` — wire `ASK_TIMEOUT_BY_ACTION` or delete it; fix ADR-030 either way. Test: extend
      `L1-L2-ask-selector`.
- [x] **B5** — `8b1e2c4` — `askQueued()` exported from `ask-flow.ts`; use it for the trust dialog and the mode
      picker. Test: `L1-L2-ask-queue`.
- [x] **B6** — `a5701c3` — clear the status chip on disable/stop; clear `latestBashCommand` on `tool_result`;
      tail-read `audit.log` in `/security`. Test: `L1-L2-status-chip`.

## Batch 5 — detection and logging

- [ ] **S6** — assert the runtime arrays before/after mutation; report failure once (`console.error`
      + audit) instead of swallowing. Extend `L1-ghost-dotfiles`.
- [x] **S9** — verified as not a finding: the basename form never applies to an outside-project
      read, and the absolute/`~` forms are the feature.
- [x] **S10** — `4e1297f` — validate and audit live domain grants (reject `*`, malformed, and `deniedDomains`);
      make yolo config/flag-authoritative, the event announcement-only. Test:
      `L1-L2-grant-channel`.
- [x] **S12** — `f239705` — audit file `0600`, rotation, one-shot error report. Test: `L2-audit-log`.
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
- [x] **S16** — `823eb21` — read tiers are deny → allow → ask; a content read no rule allows asks.
- [x] **S17** — `9a835b0` — corroborate a yolo emit against the flag/config before disabling both layers.
- [ ] **C10** — `knip` pass, prune dead exports, wire `npm run audit` (or delete the two scripts).
- [ ] **C12** — one import-specifier convention (`.ts`): codemod the 10 extensionless files in
      `src/l2-guard/`, `src/l1-sandbox/` and `src/ui/ask-flow.ts`, then a lint rule.

## Batch 7 — process and validation

- [ ] **T4** — `sandbox.schema.json`; validate the three shipped presets in the test suite; add an
      unknown-key report to the loaders (notify + audit, never throw). This catches the
      `strictAllowlst` class of support issue.
- [ ] **T5** — scheduled e2e job (`bubblewrap` + `socat` on `ubuntu-latest`) for `L1-e2e`.
- [x] **T6** — `c22a047` — 12 `uses:` pinned to SHAs, commitlint runs the devDependency, write
      scopes per job, `persist-credentials: false`, Dependabot with a 7-day cooldown, CI grep guard.
- [ ] **T7** — track `package-lock.json` and switch every workflow to `npm ci`; the publish job
      currently resolves a fresh tree while holding `id-token: write`.

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
| 0 foundations | 4 | 4 |
| 1 quick hardening | 6 | 6 |
| 2 one matcher + deny | 4 | 4 |
| 3 fail-open | 4 | 4 |
| 4 state/lifecycle | 6 | 6 |
| 5 detection/logging | 7 | 5 |
| 6 simplification | 8 | 0 |
| 7 process | 4 | 1 |
| 8 features | 6 | 0 |
| **total** | **49** | **30** |

## Landed so far

```text
docs(plan): record the audit findings and the working order        2767a56
style(format): one formatter, tabs everywhere, CI gate             90d935d
chore(git): skip the format commit in blame                        761cf76
chore(node): declare the supported engine                          93e58a8
chore(ci): gate on one aggregate check                             8fb091c
test(security): pin the manifest case counts                       95dc6ab
fix(security): keep SECURITY.md unmodified when only the date moves 06658fc
chore(format): keep JSON, YAML and Markdown at two spaces          a9b8ba3
chore(format): gate the whole repo, not just the sources           488ba1c
fix(ci): pin every action and scope write access                   c22a047
fix(sandbox): keep the bridge sockets owner-only                   b393fda
fix(ci): pin every action and scope write access                   c22a047
fix(sandbox): keep the bridge sockets owner-only                   b393fda
fix(trust): treat a policy path that is not a file as untrusted    6be8652
fix(guard): stop re-rooting an absolute grep path                  e80177e
refactor: keep the added comments describing behaviour             44919ec
fix(trust): let an untrusted project add askWrite rules            7d1f9ea
fix(detect): measure output size in bytes at every depth           6719c1c
test(paths): import the shipped matcher instead of copying it      8495500
refactor(guard): one pattern matcher for both layers               331ac24
fix(guard): a deny rule outranks a saved grant                     420798b
fix(paths): match a credential name regardless of case             8c531bd
fix(guard): a deny blocks instead of offering a prompt             a047b26
fix(sandbox): scope "just this once" to the command that asked     0603181
fix(sandbox): deny when a network prompt runs out                  489a398
fix(guard): block a URL tool whose target cannot be read           387eff8
fix(sandbox): refuse bash when no sandbox is running               233840e
test(guard): pin the fail-closed network timeout in the contract    <contract>
fix(policy): write the policy file atomically                      c6eb540
refactor(ui): drop the unused per-action timeout table             520a893
fix(ui): clear the sandbox chip and the last command                a5701c3
chore!: ship only the default policy preset                        44ddf2e
fix(guard): corroborate a yolo emit, and follow the session cwd     9a835b0
fix(ui): queue the two dialogs, and respect a project mode          8b1e2c4
```

Two findings were added while doing batches 0-1, both surfaced by tooling rather than by reading:
**T6** (workflow actions pinned to mutable tags — fixed in `c22a047`) and **C12** (mixed import
specifiers, 10 files against 57). **T7** (the publish job resolves a fresh dependency tree while
holding `id-token: write`) came out of the T6 work and is batched rather than fixed.
