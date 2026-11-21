# Security and quality audit — findings

**Status:** open — batches 0 and 1 landed (C2, T1, T2, T3, T6, S4). The working order lives in
`plan/security-audit-todo.md`; each fix lands with the test named here, and the test entry is added
to `security/manifest.json` in the same commit so `SECURITY.md` regenerates with it.

**One line:** 15 security findings, 7 behaviour bugs, 12 quality and 7 tooling items — 9 of them
carrying a reproduced output — each with the missing test named, so a fix is never "trust me".

---

## 0. How this was produced

Baseline at `07f8c39` (v6.1.2): `npm run typecheck` clean, `npm test` 54/54 files, no `any`, no
`@ts-ignore`, 19 `as unknown as` (all annotated `/* SAFETY */`). The findings below are therefore
latent, not breaking.

Every finding says how it was established:

| Marker | Meaning |
| --- | --- |
| **executed** | a probe or the shipped function was run and its output is quoted |
| **read** | established by reading the code path end to end |

Findings already listed under `knownGaps` in `security/manifest.json` are **not** repeated: raw-IP
egress, `allowLocalhost` removing `--unshare-net`, the heuristic nature of the pre-flight, the
daemon-socket bridge being host root, the Advanced Secure gate seeing only tool output, and the
recursive-search walk printing credential bytes. Those are accepted risks, and this document starts
where they stop.

### Proposed test format

Each finding names a test in the shape `security/check.sh` already consumes. The `expected`
count is a placeholder until the file exists; set it from a real run.

```json
{ "id": "<test-id>", "command": "node --import ./security/tests/ts-loader.mjs security/tests/unit/<file>.mjs", "expected": "PASS=<n>, FAIL=0" }
```

New test files follow the shipped harness shape (`security/tests/unit/read-write-posture.mjs` is
the reference — it imports the real source, unlike `path-matcher.mjs`, see C11):

```js
import { isDeniedRead } from "../../../src/l2-guard/matching.ts";

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { if (cond) pass++; else { fail++; console.log("FAIL:", name, "→", extra); } };

check("denyRead still denies when allowRead names the same folder", isDeniedRead(`${home}/secret/x`, cwd, policy) !== null);

console.log("---", "PASS=" + pass, "FAIL=" + fail);
process.exit(fail ? 1 : 0);
```

---

## 1. Security

| ID | Severity | Finding |
| --- | --- | --- |
| S1 | high | `overrides.allowRead`/`allowWrite` defeat `denyRead`/`denyWrite` |
| S2 | high | `denyRead` is askable, so a "deny" is really an ask |
| S3 | high | bash is unguarded when the L1 sandbox fails to start |
| S4 | med-high | host-port bridge socket is world-connectable |
| S5 | med | a network prompt timing out counts as *allow once* |
| S6 | med | `suppressGhostDotfiles()` silently disables runtime protections |
| S7 | med | a directory named `.pi/sandbox.json` aborts `session_start` |
| S8 | med | grep result filter misses absolute printed paths |
| S9 | med | `userNamedOutside` auto-allows on a bare basename |
| S10 | med | yolo kill switch and domain grants are unauthenticated events |
| S11 | med | policy writes are non-atomic and two layers share one file |
| S12 | low-med | audit log: default perms, no rotation, every error swallowed |
| S13 | med | `fetch_content` with no parseable URL is unrestricted |
| S14 | low | `askWrite` is not treated as a tightening by the untrusted merge |
| S15 | low-med | credential basename globs are case-sensitive on Linux |

### S1 — `overrides.allowRead` / `allowWrite` defeat the deny tiers

- **Severity:** high — an explicit deny is bypassed by a grant the prompt itself offers to write.
- **Where:** `src/l2-guard/matching.ts:84`, `src/l2-guard/matching.ts:109`
- **Executed:**

  ```text
  denyRead,  no override        : denyRead matched "/home/u/secretdir" → /home/u/secretdir/x
  denyRead,  allowRead override : null      ← deny defeated
  denyWrite, allowWrite override: null      ← deny defeated
  ```

- **Why it matters:** `checkReadAccess` turns a `denyRead` hit into a prompt with "always" rows
  (`src/l2-guard/tool-gates.ts:82`); picking one writes `overrides.allowRead`, after which
  `isDeniedRead` returns `null` before it ever looks at `denyRead`. `modelDenyRead` (`:85`) and
  `askWrite` (`:114`) are skipped by the same early return. `SKILL.md` and ADR-047 state the
  opposite ("denyRead still wins over both").
- **Fix:** move both `isOverridden(policy.overrides…)` checks below the `modelDenyRead`/`denyRead`
  and `denyWrite`/`askWrite` loops. The absolute-deny tier stays first.
- **Test:** `L2-deny-precedence` — cases: override cannot un-deny `denyRead`; override cannot
  un-deny `denyWrite`; override still beats `askRead` (deliberate, ADR-047); override still beats
  `askWrite`; absolute-deny still wins over every override.
- **Manifest entry:**

  ```json
  { "id": "L2-deny-precedence", "command": "node --import ./security/tests/ts-loader.mjs security/tests/unit/deny-precedence.mjs", "expected": "PASS=<n>, FAIL=0" }
  ```

### S2 — `denyRead` is askable, so a "deny" is really an ask

- **Severity:** high — the user-facing contract ("hard deny") does not hold.
- **Where:** `src/l2-guard/tool-gates.ts:73`, `src/core/policy/patterns.ts` (no separate tier)
- **Read:** only the six `ABSOLUTE_DENY_PATTERNS` (`matching.ts:61`) are terminal. Every other
  `denyRead` match reaches `askOrBlock` with `absoluteDenyPattern = null`, i.e. the full
  once/session/always prompt. A user who writes `denyRead: ["~/work/payroll"]` gets a dialog, not
  a wall.
- **Fix:** decide the semantic, then implement one of:
  (a) make `denyRead` terminal and document `askRead` as the only askable read tier (API break,
  but matches the words); or (b) add a `hardDenyRead`/`hardDenyWrite` list that is terminal, and
  keep `denyRead` as the askable tier with a rename in the docs.
- **Test:** `L2-deny-terminal` — `denyRead` hit never returns an ask; `askRead` hit still asks;
  `hardDeny` cannot be overridden by a session grant, a persisted override, or a user-named file.
- **Depends on:** S1 (same evaluation order).

### S3 — bash is unguarded when the L1 sandbox cannot start

- **Severity:** high — the only fail-open path in the product.
- **Where:** `extensions/guard.ts` (no `bash` branch in `tool_call`), `extensions/sandbox.ts:172`
- **Read:** `startSandbox` catches every init failure, sets `isSandboxEnabled = false` and returns;
  the session continues. L2 never inspects `bash` (its list is
  read/write/edit/grep/find/ls/fetch_content/web_search/get_search_content/mcp__\*), so after a
  failed init *nothing* enforces policy on a shell command. Same end state for
  `enabled: false` in `sandbox.json`, Windows, a missing `bwrap`/`socat`, or a runtime crash.
- **Fix:** on init failure, register a `tool_call` gate for `bash` and `user_bash` that blocks with
  a clear reason (`"sandbox unavailable — bash disabled; fix sandbox.json or run --yolo"`), and
  surface it once at `session_start` plus in the status chip. Degraded-but-safe beats silent-open.
- **Test:** `L1-fail-closed` — an init that throws leaves the bash gate armed; `enabled: false`
  arms the same gate; `--yolo` is the only path that leaves bash free.
- **Note:** the alternative (route bash through an L2 command gate using the existing
  `commands.ask`/`askRead` parsers) is a bigger change; blocking is the honest minimum.

### S4 — host-port bridge socket is world-connectable

**Status:** ✅ fixed in `b393fda` — both bridges and the bash tool's TMPDIR share `<tmp>/pi-<uid>`
(0700, created or adopted, symlink/file/foreign-owner rejected with no fallback); the port socket is
`0600` like the daemon one; `L1-bridge-perms` (17 cases) covers it.

- **Severity:** med-high — local privilege/information crossing on a shared machine.
- **Where:** `src/l1-sandbox/host-bridge.ts:227` (no chmod) vs `:138` (chmod present)
- **Read:** `startHostSocketBridge` does `chmodSync(sockPath, 0o600)`; `startHostPortBridge` listens
  and returns without it, so the socket takes the umask default (usually `0755`) and any local user
  can connect to it and reach the host's loopback ports (`bridgeHostPorts`, default `[3274]`).
- **Fix:** `chmodSync(sockPath, 0o600)` after `listen`, and create the socket inside a per-user
  `0700` directory (`/tmp/pi-<uid>/`, already computed in `src/l1-sandbox/bash-ops.ts:107`).
- **Test:** `L1-bridge-perms` — after `startHostPortBridge`, `statSync(sockPath).mode & 0o077 === 0`;
  the parent directory is `0700`; the daemon bridge keeps its `0600`.

### S5 — a network prompt timing out counts as *allow once*

- **Severity:** med — unattended egress, and inconsistent with the read/write gates.
- **Where:** `src/ui/ask-flow.ts:359` (`if (expired && opts.allowFirst) return MainChoice.Once;`)
- **Read:** `allowFirst` is set only for network asks (`src/ui/ask.ts`, `askDecision` network
  branch), so 30 s of inattention grants egress to an unknown host, while an expired read/write
  prompt blocks (`choices.find(...) ?? MainChoice.Block`).
- **Fix:** deny on expiry like every other gate; if the "don't hang the build" motivation matters,
  keep it but make it opt-in (`network.allowOnTimeout: true`, default `false`) and say so in the
  footer.
- **Test:** `L1-network-timeout` — expired network ask returns `MainChoice.Block` by default;
  returns `Once` only when the opt-in flag is set; an Esc still blocks either way.

### S6 — `suppressGhostDotfiles()` silently disables runtime protections

- **Severity:** med — a silent security-relevant mutation of another package's state.
- **Where:** `src/l1-sandbox/manager.ts:25-42`
- **Read:** the function empties the imported `DANGEROUS_FILES` array and rewrites
  `DANGEROUS_DIRECTORIES` down to `.git`, at module import, wrapped in `catch {}`. It imports a
  non-public path (`@anthropic-ai/sandbox-runtime/dist/sandbox/sandbox-utils.js`, dependency
  `^0.0.78`). If the runtime's internal shape changes, the mutation silently no-ops or half-no-ops
  and nothing reports that the guard's defences differ from what the code assumes.
- **Fix:** assert the arrays are non-empty before clearing, verify after, and on any failure emit
  one `console.error` + `audit({ layer: 1, event: "ghost-dotfile-suppression-failed" })`. Pin the
  dependency to a single version rather than a patch range.
- **Test:** `L1-ghost-dotfiles` (extend) — a stub module with a changed export shape makes the
  suppression report failure instead of swallowing it; the successful path still empties both
  arrays and keeps `.git`.

### S7 — a directory named `.pi/sandbox.json` aborts `session_start`

- **Severity:** med — a repo can disable part of the guard setup on open.
- **Where:** `src/core/trust.ts:14-20`, reached from `src/l1-sandbox/config.ts:113` and
  `src/l2-guard/policy.ts:79`
- **Executed:**

  ```text
  existsSync: true
  readFileSync throws: EISDIR
  ```

- **Read:** `fileHash` tests `existsSync` then reads. `loadConfig` calls `projectTrusted()` outside
  any `try`, and `extensions/sandbox.ts` calls `loadConfig(context.cwd)` *before* its own `try`.
  `untrustedProjectChanges` has the same shape. The throw escapes `session_start`, so the grants
  that follow (`clearSessionGrants`, `clearDetectionGrants`, `clearProgramIds`, …) never run.
- **Fix:** in `fileHash`, `statSync(p).isFile()` → else `null`; treat a non-file as untrusted. Wrap
  the `loadConfig`/`loadPolicy` calls in `session_start` so a hostile tree cannot skip cleanup.
- **Test:** `L1-L2-policy-dir` — a `sandbox.json` **directory** yields `fileHash() === null`,
  `projectTrusted() === false`, and `loadConfig()` returns the default policy without throwing.

### S8 — grep result filter misses absolute printed paths

- **Severity:** med — deny/ask-filtered lines can reach the model.
- **Where:** `src/l2-guard/output-gates.ts:65-66`
- **Executed:**

  ```text
  join   ("/root/proj", "/etc/passwd") → /root/proj/etc/passwd
  resolve("/root/proj", "/etc/passwd") → /etc/passwd
  ```

- **Read:** `filterGrepToolResult` passes `join(searchRoot, printed)` to `isDeniedRead`/`isAskRead`,
  so any grep output line whose path is absolute is matched against a nonsense path and kept.
  `security/tests/unit/grep-filter.mjs` (15 cases) has no absolute-path case.
- **Fix:** `isAbsolute(printed) ? printed : join(searchRoot, printed)`.
- **Test:** `L2-grep-filter` (extend) — an absolute printed path for a `denyRead` file is removed;
  an absolute `askRead` path is removed; a relative path still resolves under the root; the
  `--no-filename` / multi-root shapes are covered.

### S9 — `userNamedOutside` auto-allows on a bare basename

- **Severity:** med — an outside-project read happens with no prompt.
- **Where:** `src/core/user-named.ts:99-103`, `src/l2-guard/prompts.ts:138`
- **Read:** any basename of ≥3 characters becomes a candidate form and is matched as a word token
  against the last 20 user messages. A user pasting an error that contains the word `config` or
  `env` auto-approves reading `~/.config/…/config` (outside the project) for that call. The
  absolute-deny tier still protects key material; everything else is fair game.
- **Fix:** for the silent grant require a path-shaped token (contains `/`, `~`, or an extension);
  keep bare basenames behind the ask. Audit the matched form and the message index.
- **Test:** `L2-user-named` (extend) — a bare basename no longer auto-allows; a quoted path with `/`
  still does; a `~`-spelled path still does; a basename mentioned with `./` still does.

### S10 — yolo kill switch and domain grants are unauthenticated events

- **Severity:** med — any loaded extension can weaken or open the sandbox.
- **Where:** `src/shared/yolo.ts:21-55`, `src/shared/network-grants.ts:8`,
  `src/l1-sandbox/manager.ts:104-113`
- **Read:** `emitYolo(bus, true)` from any extension disables every layer (`guard.ts` and
  `sandbox.ts` both subscribe). `applyNetworkGrant(host)` appends whatever string arrives to the
  live `allowedDomains` with no validation, no deny-list re-check and no audit entry; `*` is a
  legal value for the runtime's matcher.
- **Fix:** make config and flags authoritative for yolo (the event only *announces* an already-
  decided state); validate a granted host against a hostname/pattern regex, refuse `*`, re-check
  `deniedDomains`, and `audit({ layer: 1, event: "network-grant-live", host })`.
- **Test:** `L1-L2-grant-channel` — a `*` host is rejected; a malformed host is rejected; a
  `deniedDomains` host is rejected; a valid host is appended exactly once and audited.

### S11 — policy writes are non-atomic and two layers share one file

- **Severity:** med — lost updates and total policy loss on a crash.
- **Where:** `src/core/policy/overrides.ts:36`, `src/core/policy/policy-file.ts:36`
- **Read:** both do `writeFileSync(path, JSON.stringify(...))` directly on `<cwd>/.pi/sandbox.json`.
  L1's `persistLayer1Override` and L2's `persistOverride` write the same file in one session, and
  each is a read-modify-write. A crash mid-write leaves an unparseable file, which
  `loadConfig`/`loadPolicy` swallow (`console.error`) and replace with the shipped default — i.e.
  the user's rules silently disappear until the next `session_start` notices.
- **Fix:** write to `<path>.tmp`, `fsync`, `renameSync`, then re-parse to assert; keep one
  in-process lock so both layers serialize their read-modify-write.
- **Test:** `L1-L2-policy-write` — a write leaves valid JSON and the previous keys; two sequential
  `addOverride` calls from both layers keep both entries; a simulated parse failure does not
  clobber the file; a corrupt file is reported, not silently replaced.

### S12 — audit log: default perms, no rotation, every error swallowed

- **Severity:** low-med.
- **Where:** `src/shared/audit.ts:8-20`
- **Read:** `appendFileSync` at the umask default (`0644` typical) on a file that records command
  lines, subjects and paths; no size cap or rotation; every failure is silently discarded; no
  integrity marker. `security/audit-analyze.mjs` exists for analysis but nothing rotates or
  protects the file, and `/security` reads it **whole** to print ten lines
  (`src/l2-guard/report.ts:146`).
- **Fix:** create with `0o600`, rotate at a configured size, report the first write failure once
  (notify + stderr), and read only the tail for `/security`.
- **Test:** `L2-audit-log` — the file is created `0600`; rotation keeps the newest entries and
  bounds the size; a write error surfaces once and never throws into the tool path.

### S13 — `fetch_content` with no parseable URL is unrestricted

- **Severity:** med — a silent bypass if the tool's input shape differs.
- **Where:** `src/l2-guard/tool-gates.ts:124-144`
- **Read:** only `input.url` (string) and `input.urls` (array of strings) are collected. Any other
  shape — an array of objects, a `query`-only fetch, a renamed field — yields zero URLs, and a
  zero-URL call is allowed because the loop simply does not run.
- **Fix:** for the URL tools, ask/block when zero URLs were extracted; log the raw input keys in
  the audit entry so a shape change is diagnosable.
- **Test:** `L2-url-unparsed` — `{ url: "https://x" }` is checked; `{ urls: [...] }` is checked; a
  call with no recognised URL field is blocked/asked instead of allowed.
- **Note:** confirm the real schema of `fetch_content`/`get_search_content` before choosing
  block-vs-ask; nothing in this repo pins it.

### S14 — `askWrite` is not treated as a tightening by the untrusted merge

- **Severity:** low — a false warning, and a tightening an untrusted project cannot express.
- **Where:** `src/core/trust.ts:149` (`ADDITIVE_DENY_KEYS`), `src/core/trust.ts:346`
- **Read:** the additive list is `denyRead, modelDenyRead, denyWrite, askRead`. An untrusted
  project that adds `askWrite` (strictly *more* prompts) lands in `ignoredKeys`, and
  `describeLoosening`'s default branch then tells the user, in the `/security trust` dialog,
  `Change the setting "filesystem.askWrite".`
- **Fix:** add `askWrite` to `ADDITIVE_DENY_KEYS`; keep the default branch for genuinely unknown
  keys.
- **Test:** `L1-L2-project-trust` (extend) — an untrusted `askWrite` entry is merged (additively);
  `describeLoosening` reports nothing for it; a genuinely loosening key still reports.

### S15 — credential basename globs are case-sensitive on Linux

- **Severity:** low-med — `SECRET.PEM`/`ID_RSA`-style names miss the deny/ask tier on Linux.
- **Where:** `src/l2-guard/matching.ts:29` (`process.platform === "darwin" ? "i" : ""`)
- **Executed:**

  ```text
  platform: linux
  shipped  *.pem vs /home/u/FILE.PEM : false
  ```

  while `security/tests/unit/path-matcher.mjs` pins `/i` on every platform — the test asserts the
  opposite of the shipped behaviour (see C11).
- **Fix:** make basename matching case-insensitive on every platform (a `.PEM` is as sensitive as a
  `.pem`); keep full-path prefix matching case-sensitive on Linux so `/home/u/x` and `/home/U/x`
  stay distinct.
- **Test:** `L2-path-case` — `*.pem` matches `FILE.PEM` and `file.Pem` on every platform; a
  full-path deny entry stays case-sensitive on Linux; `domainMatches` is unaffected (already
  lowercases).
- **Depends on:** C1 (decide the semantics in the one shared matcher).

---

## 2. Behaviour bugs

| ID | Finding |
| --- | --- |
| B1 | network "just this once" is never armed in production |
| B2 | `process.cwd()` is captured at module load |
| B3 | `/permission-mode` writes global only, but the project file wins |
| B4 | `ASK_TIMEOUT_BY_ACTION` is dead; real timeouts differ from the docs |
| B5 | `/security trust` and `/permission-mode` bypass the ask queue |
| B6 | stale status chip, stale `latestBashCommand`, whole-file audit read |
| B7 | `estimateSize` mixes UTF-16 length and bytes |

### B1 — network "just this once" is never armed in production

- **Severity:** high (functional) — the documented behaviour does not exist.
- **Where:** `src/l1-sandbox/network-ask.ts:41-49`, `:157`, `:182`
- **Executed (`rg` over the whole tree):** `beginNetworkCommand` / `endNetworkCommand` are imported
  only by `security/tests/unit/network-ask.mjs`; no production call site exists.
- **Consequence:** `commandGrants` is permanently `null`, so `commandGrants?.add(host)` does
  nothing and `granted()` never returns `"command"`. One `npm install` re-prompts for the same host
  on every sequential connection; `pending` only collapses concurrent ones. `SKILL.md` says "`yes`
  — this once covers that bash command's connections", and `network-ask.mjs` has 45 cases proving
  it — all of them calling the pair by hand.
- **Fix:** arm the window in `src/l1-sandbox/bash-ops.ts` around the whole execution
  (`beginNetworkCommand()` / `finally endNetworkCommand()`), so retries inherit it too.
- **Test:** `L1-network-once` — a `once` decision covers a second and third request to the same
  host inside one command; a request after the command asks again; a reload keeps the window
  closed.
- **Note:** the pair is exported and unit-tested, which is exactly why this survived; the missing
  piece is the production wiring, not the logic.

### B2 — `process.cwd()` is captured at module load

- **Severity:** med — grants land in, and config is loaded from, the wrong directory.
- **Where:** `extensions/sandbox.ts:66` and its use at `:120`, `:129`
- **Read:** `const initialWorkingDirectory = process.cwd()` feeds `createBashTool`,
  `persistLayer1Override` and `reloadSandbox`, while every decision path uses `context.cwd`. A pi
  session started below the repo root, or one whose cwd changes, writes `always` grants into the
  wrong `.pi/sandbox.json` and reloads the wrong policy.
- **Fix:** keep a module-level `currentWorkingDirectory` updated at `session_start` from
  `context.cwd`, and pass it everywhere `initialWorkingDirectory` is used today.
- **Test:** `L1-cwd-source` — `persistLayer1Override`/`reloadSandbox` receive `context.cwd`; a
  session whose `context.cwd` differs from `process.cwd()` writes and reloads there.

### B3 — `/permission-mode` writes global only, but the project file wins

- **Severity:** med — a security downgrade the user believes they fixed (and the reverse).
- **Where:** `extensions/permission-mode.ts:137`; precedence at `src/core/policy/merge.ts:5`
- **Read:** `setPolicyMode(GLOBAL_POLICY_PATH, nextMode)`; `overlayPolicy(global, project)` puts
  project on top. In a project that pins `"mode": "default"`, choosing *Advanced Secure* changes
  nothing while the toast says it is on; choosing *YOLO* leaves the sandbox running.
- **Fix:** read the project file's `mode`; if it overrides the choice, say so in the toast and
  offer `setPolicyMode(projectPolicyPath(cwd), …)` when the project is trusted.
- **Test:** `L1-L2-permission-mode` (extend) — a project `mode` is detected and reported; a write
  either reaches the project file or the message names the file that wins; no silent no-op.

### B4 — `ASK_TIMEOUT_BY_ACTION` is dead; real timeouts differ from the docs

- **Severity:** low.
- **Where:** `src/ui/ask-flow.ts:77` (exported, never imported — verified with `rg`)
- **Read:** documented values are read 15 s, write 15 s, network 30 s, remember 60 s; the code
  always uses `ASK_TIMEOUT_MS` (15 s), because `askRememberFile`/`askRememberHost`/`askExposure`
  pass `undefined` and the default parameter applies.
- **Fix:** either derive `timeoutMs` from the action in `askMain`/`askDecision`, or delete the
  constant and correct ADR-030's text. Pick one — a dead table that disagrees with the code is
  worse than no table.
- **Test:** `L1-L2-ask-selector` (extend) — each action resolves to its documented timeout; the
  remember screen gets the longer budget.

### B5 — `/security trust` and `/permission-mode` bypass the ask queue

- **Severity:** med — the exact race the queue exists to prevent (ADR-034).
- **Where:** `src/l2-guard/report.ts:51`, `extensions/permission-mode.ts:101`
- **Read:** both call `context.ui.select()` directly; `src/ui/ask-flow.ts` states "every select goes
  through the re-entrant `enqueue`; there is no bypass". pi's selector is a singleton, so a
  sandbox ask and the trust dialog can replace each other, and the sandbox proxy awaits a promise
  that will not resolve until its own timeout.
- **Fix:** export an `askQueued(ctx, title, options)` from `ask-flow.ts` and use it for both
  dialogs (the mode picker keeps its own 120 s timeout, just inside the slot).
- **Test:** `L1-L2-ask-queue` — a trust dialog and a sandbox ask never overlap; the second waits
  for the first; the timeout of the first does not dispose the second.

### B6 — stale status chip, stale `latestBashCommand`, whole-file audit read

- **Severity:** low.
- **Where:** `extensions/permission-mode.ts:54`, `extensions/sandbox.ts:263`, `src/l2-guard/report.ts:146`
- **Read:** `renderSandboxChip` returns without clearing status when `!config.enabled`, so the old
  "Sandbox: 🧠 N domains" chip stays on screen after disabling. `latestBashCommand` is set on
  every `bash` call and never cleared, so a later network ask can print an unrelated stale
  `Command` row. `/security` reads the entire `audit.log` to show the last ten lines.
- **Fix:** `setStatus("sandbox", undefined)` on disable/stop; clear `latestBashCommand` on
  `tool_result`; read the tail (bounded read or `readline` from the end).
- **Test:** `L1-L2-status-chip` — disabling clears the chip; a stale command never appears in a
  later ask body.

### B7 — `estimateSize` mixes UTF-16 length and bytes

- **Severity:** low.
- **Where:** `src/detect/tool-output-scanner/size.ts:25` vs `:41`
- **Read:** the top-level string path uses `Buffer.byteLength`; nested strings use
  `current.length + 2` (UTF-16 code units). A payload of non-ASCII output is under-counted, so the
  64 KiB scan cap admits more bytes than intended, and `exceeded` can be false for a payload that
  is over the byte limit.
- **Fix:** use `Buffer.byteLength(current, "utf8")` for every string leaf.
- **Test:** `L2-detect-size` — a 40k-character multibyte string is measured in bytes; the cap and
  `exceeded` agree between the string path and the structure path.

---

## 3. Code quality and simplification

| ID | Finding |
| --- | --- |
| C1 | two glob matchers — L1 and L2 disagree on the same policy entry |
| C2 | no formatter, no linter; 25 of 109 files are 2-space, the rest tabs |
| C3 | the policy-layer wiring is duplicated in L1 and L2 |
| C4 | two ask stacks for the same flow |
| C5 | three "first word of a command" helpers |
| C6 | `export *` on the core index hides the boundary |
| C7 | the policy is reloaded on every tool event |
| C8 | the largest files, and a retry path with no depth bound |
| C9 | naming drift in user-facing strings |
| C10 | dead exports and two unwired scripts |
| C11 | `path-matcher.mjs` is a copy of the matcher, not a test of it |
| C12 | mixed import specifiers: `.ts` in 57 files, extensionless in 10 |

### C1 — two glob matchers; L1 and L2 disagree on the same policy entry

- **Severity:** high (quality) — this is the "both layers share one policy" invariant.
- **Where:** `src/core/policy/patterns.ts:matchesPolicyPattern` (L1) vs
  `src/l2-guard/matching.ts:matchPattern` (L2)
- **Executed (same path, same pattern, both shipped functions):**

  ```text
  DRIFT  @-spelled pattern     L1=false  L2=true
  DRIFT  file:// pattern       L1=false  L2=true
  same   glob star             L1=false  L2=false
  same   tilde                 L1=true   L2=true
  ```

  So `denyRead: ["@/home/u/.secrets"]` or `file:///home/u/.secrets` is enforced by the tool guard
  and **not** by the bash sandbox: `matchPattern` normalises the pattern through
  `normalizeUserPath` (`src/core/policy/user-path.ts:11`), `matchesPolicyPattern` only handles `~`.
  They also differ on `.` (canonicalised cwd vs raw cwd).
- **Fix:** move one matcher into `src/core/policy/` and have `matching.ts` re-export it; delete the
  duplicate. `merge.ts` already sets this precedent for layering.
- **Test:** `L1-L2-path-parity` — a table of patterns run through **both** entry points, asserting
  identical results: `~`, `@`, `file://`, `.`, absolute prefix, absolute glob, basename, basename
  glob, case variants, trailing slash.
- **Blocks:** S15 (semantics decided here).

### C2 — no formatter, no linter

**Status:** ✅ fixed in `90d935d` — prettier owns `extensions/` and `src/`, tabs, `printWidth: 120`,
`npm run format:check` in CI. `security/**/*.mjs`, `*.md` and the shipped policy JSON stay out
until C11/C8 stop rewriting them (`.prettierignore` says so).

- **Severity:** med (quality) — 15k lines, two indent conventions, nothing enforces either.
- **Executed:** 25 of 109 `.ts` files start a top-level statement with two spaces (all of
  `src/detect/**`: filename-gate, mcp-gate, sensitive-file-scanner, tool-output-scanner); the other
  84 use tabs. No prettier/biome/eslint/editorconfig in the repo, no `lint`/`format` script, and
  `ci.yml` runs only typecheck + tests.
- **Fix:** add one formatter (tabs to match the 84), run it once as an isolated commit, add
  `"format": "…"` + `"lint": "…"` and a CI check step. Do it before the code-movement items so
  their diffs stay reviewable.
- **Test:** n/a (CI step is the test).

### C3 — the policy-layer wiring is duplicated in L1 and L2

- **Where:** `src/l1-sandbox/config.ts:61-77` and `src/l2-guard/policy.ts:56-73`
- **Read:** both re-derive `DEFAULT_* = shippedPolicy()`, `TRUST_STORE = trustStorePath(getAgentDir())`,
  `createProjectTrust`, `setPiDeclinedTrust`, `projectTrusted`, and a near-identical `load*()` loop
  over the same two paths; both extensions call `setPiDeclinedTrust` in `session_start`.
- **Fix:** one `src/shared/policy-layer.ts` (one trust store, one loader, two typed views), then
  delete the copies.
- **Test:** existing `L1-L2-project-trust`, `L1-L2-defaults`, `override-store` must stay green
  unchanged — that is the acceptance.

### C4 — two ask stacks for the same flow

- **Where:** `src/l1-sandbox/network-ask.ts:98-187` vs `src/ui/ask.ts:177-259`
- **Read:** ~100 duplicated lines: the wildcard group label, the "Always allow connecting — what,
  and where?" screen, the untrusted-project note, the persist-failure fallback, the audit rows.
  `askRememberFile`/`askRememberHost`/`askExposure` also repeat build-choices → select → find.
- **Fix:** one `askNetworkGrant(ctx, host, deps)` in `src/ui/` used by both layers; one
  `pickOption<T>(ctx, title, choices, opts)` helper for the three remember screens.
- **Test:** `L1-L2-network-grants` + `ask-flow` must stay green; add one case asserting L1 and L2
  produce identical prompt text for the same host.

### C5 — three "first word of a command" helpers

- **Where:** `src/l1-sandbox/bash-preflight.ts:43` (`extractBinaryName`),
  `src/l1-sandbox/network-ask.ts:82` (`firstWord`, adds `sudo`/`command` stripping),
  `src/core/policy/shell-command.ts:56` (`binaryName`)
- **Fix:** one core helper with the wrapper stripping; both call sites use it.
- **Test:** `L1-bash-candidates` (extend) — `sudo cmd`, `command cmd`, `\cmd`, `VAR=1 cmd` resolve
  to the same head through all three former paths.

### C6 — `export *` on the core index hides the boundary

- **Where:** `src/core/index.ts` (29 `export *`)
- **Read:** the pure core and tool-view helpers share one namespace, so nothing stops a security
  module importing view code (or the reverse), and "pure core" is a comment rather than a boundary.
- **Fix:** named re-exports per subfolder (`export { … } from "./policy/paths.ts"`), or subpath
  entries. Purely mechanical; `tsc` keeps it honest.
- **Test:** typecheck only.

### C7 — the policy is reloaded on every tool event

- **Where:** `extensions/guard.ts:145` (`tool_call`), `:216` and `:226` (two `tool_result`
  handlers), `src/l1-sandbox/bash-ops.ts:113` (per attempt)
- **Read:** `loadPolicy` does `existsSync` + `readFileSync` + `JSON.parse` + `structuredClone` of
  the shipped default on **every** tool call and twice per result; `loadConfig` runs 4–6× per bash
  command (each pre-flight + each attempt).
- **Fix:** an mtime-keyed cache (`statSync(...).mtimeMs` + size) invalidated by the writers, and
  one `loadPolicy` per event shared by the two `tool_result` handlers.
- **Test:** `L1-L2-policy-cache` — repeated loads hit the cache; a touched file is re-read; a
  writer invalidates immediately.

### C8 — the largest files, and a retry path with no depth bound

- **Where:** `bash-recovery.ts` (570), `ask.ts` (505), `ask-flow.ts` (498), `find-query.ts` (482),
  `row-group.ts` (451), `target-summary.ts` (425)
- **Read:** `target-summary.ts` carries ~10 near-identical `tokens.at(-1) ?? …` tail helpers (a
  table would collapse them). `handleBlockedBashExecution` retries by recursion
  (`attemptExecution` → `retryExecution`) with no depth counter; the per-command
  `grantedWriteFolders`/`grantedWriteFiles` sets stop today's observed loops, but the bound is
  implicit.
- **Fix:** one `MAXIMUM_RETRIES` constant and a guard at the top of `handleBlockedBashExecution`;
  a table for the target-summary tails. Treat the rest as opportunistic.
- **Test:** `L1-attribution` (extend) — the retry path stops after N attempts with a clear notice.

### C9 — naming drift in user-facing strings

- **Where:** `extensions/guard.ts:94`, `src/l1-sandbox/bash-preflight.ts:41`, `:110`,
  `src/l2-guard/output-gates.ts:94`, `extensions/sandbox.ts:189`
- **Read:** the same product speaks as `security-guard:`, `sandbox:`, `[Security Policy Notice]`,
  `[Security Block]`, `🛡️`, and `security-guard: removed N line(s)`; comments mix `Layer 1`/`L1`.
- **Fix:** one `src/shared/messages.ts` with the prefixes and the few reusable sentences.
- **Test:** `L2-output-blocks` / `L1-attribution` stay green.

### C10 — dead exports and two unwired scripts

- **Executed:** `networkSessionGrantSummary()` and `programOutputSessionGrantSummary()` have no
  caller; `ASK_TIMEOUT_BY_ACTION` is imported nowhere; a crude cross-file scan found 89 exported
  names with no reference outside their module (most are intentional re-exports — worth a real
  tool). `security/audit-analyze.mjs` and `security/verify-prompts.mjs` are reachable only by
  typing the path: absent from `package.json`, `security/check.sh`, and the README.
- **Fix:** add `knip` (dev-only) and prune; wire the analyzer as `npm run audit` (and document it
  in the README), or delete both scripts.
- **Test:** n/a (CI step).

### C11 — `path-matcher.mjs` is a copy of the matcher, not a test of it

- **Executed:** `grep -c '^import .*src/' security/tests/unit/path-matcher.mjs` → `0`. The file
  re-implements `expandHome`, `globToRegex`, `canonicalize` and `matchPattern` inline (its header
  even says "Mirrors the … logic … TODO"), and it pins `new RegExp(re, "i")` unconditionally,
  while the shipped `globToRegex` is case-insensitive only on darwin. On Linux:

  ```text
  shipped  *.pem vs /home/u/FILE.PEM : false
  test copy                          : true
  ```

  The suite therefore asserts the *opposite* of the shipped behaviour for case-mismatched
  credential names, and cannot detect drift in anything it copies.
- **Fix:** import `matchPattern` from `src/l2-guard/matching.ts` (as `read-write-posture.mjs`
  already does) and delete the local copies; expect the case rows to fail until S15 lands — that
  is the point.
- **Test:** the rewritten `path-matcher.mjs` is the test.

### C12 — mixed import specifiers

- **Where:** `src/l2-guard/` (6 files), `src/l1-sandbox/` (3), `src/ui/ask-flow.ts` (1)
- **Executed:** 10 of the 67 files that import a relative module use an extensionless specifier
  (`from "../core/index"`); the other 57 use `.ts` (`from "../core/index.ts"`). No file mixes both,
  so this is a per-directory convention, not a per-file accident. Both resolve
  (`moduleResolution: bundler` + `allowImportingTsExtensions`), so nothing enforces either — and a
  reader moving between `src/core` and `src/l2-guard` sees two styles for the same thing.
- **Fix:** pick one. `.ts` is the majority and is what `src/core` and `extensions/` already do; a
  codemod on the 10 files plus a lint rule keeps it.
- **Test:** n/a — the lint rule is the test.

---

## 4. Tooling and process

### T1 — no `engines`, no `.nvmrc`

**Status:** ✅ fixed in `93e58a8` (`engines.node >=22.19.0`, `.nvmrc` 24).

`package.json` has no `engines` field and CI pins Node 24. The floor is set by pi itself, not by
this package: `@earendil-works/pi-coding-agent` declares `"node": ">=22.19.0"`, and an extension
cannot run without it. Our own code needs ≥20.11 (`register()` hooks, `import.meta.dirname`), so
declaring pi's floor is both honest and stricter. An install on an older Node fails opaquely
today. Add `"engines": { "node": ">=22.19.0" }` and `.nvmrc` (`24`).

### T2 — no aggregate check script

**Status:** ✅ fixed in `8fb091c` — `npm run check` is typecheck + every test + the manifest suite and
render; `ci.yml` and `release-tag.yml` both call it.

`npm test` does not typecheck, and `security/check.sh` is not on any npm script. Add
`"check": "npm run typecheck && npm test && ./security/check.sh"` and use it in CI and at release
time.

### T3 — manifest `expected` counts are unenforced

**Status:** ✅ fixed in `95dc6ab` — `check.sh` compares the last reported `PASS=`/`FAIL=` against the
pin and fails on a mismatch (a note-carrying entry is held to `FAIL=0`); the gate immediately caught
8 stale pins and 3 missing L2 output-gate tests. The 17 `tool-view-*` files stay unlisted by design
and are printed as a note.

`security/manifest.json` stores `"expected": "PASS=59, FAIL=0"` per test, but
`security/check.sh` only inspects the exit status and `npm test` ignores counts entirely — so
`SECURITY.md` publishes numbers nothing verifies, and adding one assertion to an existing test
silently desyncs the doc. Decide: assert the counts in `check.sh` (preferred — it turns the doc
into a contract), or drop the field from the manifest and the renderer.

The manifest also lists **36** test entries while 54 unit + contract files exist. The 20 unlisted
are the `tool-view-*` suite (display-only, legitimately outside a security dashboard) plus
`output-blocks`, `output-allow-notice` and `program-id`, which are L2 output-gate tests and
therefore arguably in scope. Have `check.sh` **warn** about unlisted files rather than fail; pinning
counts is what makes the listed ones trustworthy.

### T4 — no JSON Schema for `sandbox.json`

`assets/schema.jsonld` is SEO metadata, not validation. Unknown keys are silently ignored today
(`strictAllowlst`, `allowReads`, a typo'd `outsideProject` key — all no-ops with no warning).
Publish `sandbox.schema.json`, validate the shipped presets against it in the test suite, and add
an unknown-key report to `loadPolicy`/`loadConfig` (one `notify` + audit entry, never a throw).

### T5 — the e2e suite never runs on a schedule

`L1-e2e` is `expected: manual` (`APS_E2E=1`) because it needs `bwrap`/`socat`. Nothing runs it in
CI, so runtime drift surfaces in users' sessions. Add a nightly `workflow_dispatch`/`schedule` job
on `ubuntu-latest` that installs `bubblewrap` + `socat` and runs it.

### T6 — workflow actions are pinned to mutable tags

**Status:** ✅ fixed in `c22a047` — 12 `uses:` pinned to commit SHAs (checkout v7.0.1, setup-node
v7.1.0), `commitlint.yml` runs the `@commitlint/cli` devDependency instead of a third-party action,
write permissions scoped to the job that needs them, `persist-credentials: false` on every checkout
that does not push, Dependabot keeps the pins moving (7-day cooldown), and `ci.yml` fails on a
mutable ref. One rule is suppressed inline with its reason: zizmor's `cache-poisoning` on the
`npm install` in `release-tag.yml`, because no step caches anything and the write-capable job
installs nothing. Revisit if the release path is ever split.

- **Where:** `.github/workflows/ci.yml`, `release-tag.yml`, `release.yml`, `commitlint.yml`
  (`actions/checkout@v7`, `actions/setup-node@v7`)
- **Read:** a tag is mutable — whoever controls the action repository can repoint `v7` at new code —
  and `release-tag.yml` runs with `contents: write`. Pinning to a full commit SHA with the version in
  a comment removes that trust, and a bot keeps the pins current.
- **Fix:** `uses: actions/checkout@<40-hex> # v7.x.y` in every workflow, plus Dependabot for
  `github-actions` so the pins do not rot.
- **Test:** n/a — a CI grep (`uses: .*@v[0-9]` must not appear) is the test.

### T7 — the publish job installs dependencies with no lockfile

- **Where:** `.github/workflows/release.yml` (one job: `npm install` → typecheck/tests →
  semantic-release), `.gitignore` (`package-lock.json`)
- **Read:** the repository tracks no lockfile, so `npm install` resolves the whole tree fresh on
  every run — and the job that runs it also holds `contents: write` and `id-token: write`. A
  malicious or compromised transitive release published in that window executes with publish
  authority. `ci.yml` has the same non-reproducible install, but read-only, so it is a correctness
  problem there rather than an authority one.
- **Fix:** track `package-lock.json` and use `npm ci` everywhere (both workflows, the docs, and
  `PUBLISHING.md`); a lockfile is also what makes "the tests passed" mean the same tree twice.
  If a lockfile is deliberately out of scope, split the publish job from the install job so no
  process that resolved a fresh tree ever holds `id-token: write`.
- **Test:** n/a — `npm ci` fails on a missing or drifted lockfile, which is the assertion.

---

## 5. Feature candidates

Ordered by value per line of code.

1. **F1 — `/security explain <path|url>`** — run the shipped `isDeniedRead` / `isAskRead` /
   `outsideProjectReason` / `isAllowedUrl` chain in evaluation order and print which rule fired
   and where it is defined. Every function already returns a reason string, so this is mostly
   formatting, and it removes the "why was this blocked" support load.
2. **F2 — session-grant visibility and reset** — `/sandbox` shows filesystem grants but not network
   (`networkSessionGrantSummary`, unused) or L2 output grants (`programOutputSessionGrantSummary`,
   unused). Add both, plus `/security reset` to clear conversation grants without a new chat —
   today the documented answer to "why does it still allow this" is "start a new conversation".
3. **F3 — `--security-dry-run`** — evaluate every gate, audit the decision, allow the call, print one
   summary at turn end. Lets a team onboard a project before trusting its `.pi/sandbox.json`, and
   it is the fastest way to see whether the default policy fits their repo.
4. **F4 — fail-closed bash fallback (S3's other half)** — when L1 is unavailable, gate `bash` at L2 with
   the existing `commands.ask` + read/write attribution parsers instead of blocking it outright.
   The parsers are already shared, so it is a wiring job, and it turns the single fail-open path
   into a degraded-but-safe mode.
5. **F5 — L4 browser gate** — `chrome_devtools_*` is listed `not-started`. `checkNetworkAccess` +
   `extractUrlsFromInput` cover navigate/new-page with the same allowlist; the MCP gate already
   has the verb classifier to borrow.
6. **F6 — `security-report` over the existing analyzer** — denials per layer per session, most-prompted
   paths, and "rules that never fired" (which `denyRead`/`askRead` entries are dead weight). The
   last column is what makes a policy maintainable.

---

## 6. Not a finding (already an accepted risk)

Recorded here so nobody re-reports them: raw-IP egress bypassing the domain allowlist;
`allowLocalhost: true` removing `--unshare-net` on Linux (the allowlist is advisory while it is
true); the network ask receiving only `host:port`; the pre-flight and `askRead` being heuristic;
the daemon-socket bridge carrying the user's group authority (host root for docker); the Advanced
Secure gate seeing only tool output; `denyRead`/`askRead` folder entries and the recursive-search
walk; writes being wide by default; the prompt queue serialising only this extension's asks.

Two of them are worth revisiting once the above lands, because the code has since moved:
`allowAllUnixSockets: true` is the shipped default (it disables seccomp AF_UNIX blocking — a large
surface for a default), and `allowLocalhost: true` is what makes the network allowlist advisory.
Both are one-line policy changes with a documented blast radius.
