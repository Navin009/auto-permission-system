---
name: auto-permission-system
description: Use this skill ONLY when the user explicitly asks about auto-permission-system, security for Pi, configuring security policies, or permission modes. Do NOT invoke this skill automatically when an action or tool is blocked during regular coding tasks.
---

# Security for Pi (Pi Permission System) — Skill

Use this skill when the user asks about the auto-permission-system extension, security for Pi, permission system for Pi, how to secure Pi, or configuring Claude auto mode for Pi.

## Handling Blocked Operations (Agent Behavior Guideline)

When a command, file operation, or tool call is blocked by the security policy:
- **Do not inspect plugin internals**: Do NOT read files inside `auto-permission-system`, do NOT inspect sandbox runtime code, and do NOT attempt to find bypasses or workarounds.
- **Explain clearly**: Calmly and concisely inform the user what specific action was restricted and why.
- **Ask to change permission mode**: Ask the user if they wish to adjust the permission mode using `/permission-mode` to allow the action.
- **Wait for user input**: Do not proceed with speculative workarounds or retry loops until the user responds or updates the mode.


## What this extension does

**Layer 1 — Bash sandbox (OS-level)**
Wraps the `bash` tool with `sandbox-exec` (macOS) or `bubblewrap` (Linux). Blocks:
- Filesystem writes outside `allowWrite`
- Filesystem reads of `denyRead` paths (defaults include `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.pi/agent`)
- Filesystem reads outside the project when `outsideProject.read` is `"ask"` or `"deny"` — when set, the home dir (and the project's parent) is fenced with `denyRead` and the project plus `allowWrite`/`outsideProject.allowRead` are re-exposed (ADR-014). With `"ask"`, a bash command that *plainly* names an outside path is confirmed with you **before it runs** (ADR-015): allow (`yes — this once`, or a persistent `always` grant) → the real, complete output; deny → the command is not run at all (no silently trimmed output). `install`/`npm` under `~/.pi/agent` are pre-allowed via `outsideProject.allowRead`, so they never prompt. Obfuscated reads still hit the fence and stay masked.
- Network egress to domains not in `allowedDomains`: a host in neither list asks before the proxy decides (ADR-023) — `yes — this once` covers that bash command's connections to the host, `yes — for this conversation` lasts until the conversation ends, and `always` writes `overrides.allowDomains` and applies live. A host in `deniedDomains`, or `network.strictAllowlist: true`, is a hard deny that is never ask-able; headless blocks.

**Layer 2 — In-process tool guard**
Hooks `tool_call` for `read`, `grep`, `find`, `ls`, `write`, `edit`, `fetch_content`, `web_search`, `get_search_content`. Applies the same policy file as Layer 1. For `grep`, `find` and `ls` the search root is checked like a `read` path. A `tool_result` hook also removes `grep` output lines from denied files beneath an allowed root (for example a `.env` deep in the tree); approving the root does not approve those files. When a call is blocked, shows an interactive prompt with persistence options.

**Layer 3 — Subagent posture & Claude Auto Mode**
When `ctx.hasUI === false` (subagents, `-p`, JSON mode, CI/CD runs), applies the `subagent.network` policy: `allow` (default) | `deny` | `research-only`. In Claude Auto Mode, unapproved prompts fail closed.

## Tool view (display only)

`/tool-view compact` draws tool calls as one row each, `/tool-view full` returns Pi's own output, and the choice is saved in `~/.pi/agent/tool-view.json`. It is a renderer and nothing else: it never reads or writes `sandbox.json`, and a blocked or denied call keeps its `✗ blocked` / `✗ denied` mark on the row. Never treat the tool view as a security setting, and never suggest switching it as a way around a block.

## Policy files

Merged in order (later wins):
1. `sandbox.default.json` — shipped baseline: key material hard-denied (`~/.ssh`, `~/.gnupg`, `~/.pi/agent/auth.json`, plus `*.pem`/`*.key` from the credential tier), credential stores asking on read as **folders** (`~/.aws`, `~/.kube`, `~/.docker`, `~/.config/gcloud`), a wide write posture (`allowWrite` includes `~`) with critical files asking on write, and `outsideProject.read: "allow"` (so `sandbox.claude.json` is what turns the boundary on)
2. `sandbox.claude.json` — shipped Claude Auto Mode preset for headless, Docker, and CI/CD runs (`strictAllowlist: true`, `outsideProject.read: "deny"`)
3. `~/.pi/agent/extensions/sandbox.json` — global user policy
4. `<cwd>/.pi/sandbox.json` — project-local overrides (also written by ask-tier prompts)

A higher layer only states what it changes; absent keys keep the layer below. A **trusted** project may loosen the baseline; an **untrusted** project may only tighten it (ADR-013). You do not need a global file for good defaults (ADR-016).

## Key policy fields

```jsonc
{
  "enabled": true,
  "mode": "default",                     // "default" (rules) | "advanced-secure" (secret detection, ADR-018)
  "network": {
    "allowLocalhost": true,                // true (default): localhost on all ports allowed; false: strict network isolation
    "allowedDomains": ["github.com", "*.github.com"],  // empty = allow all
    "deniedDomains": [],                   // hard deny, never ask-able
    "strictAllowlist": false               // true = deny unknown hosts instead of asking
  },
  "filesystem": {
    "denyRead": ["~/.ssh", "~/.pi/agent/auth.json"],  // Layer 1 + 2: hard block, no prompt. Key material only (the shipped list also has ~/.gnupg)
    "askRead": [".env", "~/.aws"],  // Layer 1 + 2: ask before reading (ADR-019). A folder entry covers every file beneath it. One read at a time, never remembered (ADR-046)
    "allowRead": ["~/.aws/config"],  // explicit allow wins over an askRead folder, so a noisy store can be silenced without editing the ask list
    "modelDenyRead": ["~/.netrc"],    // Layer 2 only: model read blocked, subprocesses ok
    "allowWrite": [".", "/tmp", "~"],  // Layer 2: write only inside these. A write does not leak a token, so this stays wide
    "denyWrite": ["~/.ssh", "~/.gnupg"],  // Layer 1 + 2: always blocked. Key material only (the shipped list also has ~/.pi/agent/auth.json)
    "askWrite": [".env", "~/.bashrc"] // Layer 1 + 2: ask before writing, so a critical file never changes under you (ADR-045, ADR-047)
  },
  "subagent": { "network": "allow" },
  "mcp": {                           // Advanced Secure MCP gate tuning (ADR-032)
    "allowTools": ["mcp__diffusion_studio__context"],  // exact names that never ask
    "allowPrefixes": ["mcp__ticktick__get_"],          // name prefixes that never ask
    "askTools": [],                   // exact names that always ask
    "trustAnnotations": false,        // true = a server's readOnlyHint allows without asking
    "allowSimpleUpdates": true,       // narrow field updates skip the ask
    "askThreshold": 30                // risk score at which a call asks (lower = stricter)
  },
  "commands": {
    "ask": ["printenv", "env", "/proc/**/environ"]  // bash: ask before these (they can print env tokens). Shell wrappers are traversed, so `sh -c printenv` and `bash -c 'printenv'` are caught too
  },
  "overrides": {                      // written by ask-tier prompts or manual edits
    "allowRead": [],
    "allowWrite": [],
    "allowDomains": []
  }
}
```

## Path spellings

Both layers normalise a spelled path the same way pi's own tools do before matching it (ADR-044): `~` / `~/x` expand to the home folder, one leading `@` is dropped, a `file://` URL becomes its path, and Unicode spaces fold. So `read ~/.ssh/id_rsa`, `read file:///home/me/.aws/config` and `read @/etc/passwd` are matched exactly like the absolute spelling — a rule cannot be walked past by spelling the same file differently. Relative or bare patterns (`.env`, `*.pem`) still match the file name anywhere.

## Absolute-deny tier

Paths matching `~/.ssh`, `~/.gnupg`, `~/.aws`, `*.pem`, `*.key` and pi's own `~/.pi/agent/auth.json` are always high-risk blocks. To allow one call the user picks *allow this ONE call* in a menu that defaults to block, then *Yes* in a second menu that also defaults to No. Enter-Enter blocks. In headless mode these calls are always blocked. The "always" option is never available for these paths.

## Project policy trust

A project `.pi/sandbox.json` applies in full only after the user trusted its exact content with `/security trust` (stored in `~/.pi/agent/extensions/sandbox.trust.json`). Untrusted, only its block rules and stricter settings apply; changes that make security weaker are ignored, and a warning lists them in plain words. A "No" answer stops the warning until the file changes. If a user's project overrides "stopped working", check `/security` ("not trusted") and suggest `/security trust`. Never suggest editing the trust store by hand.

## Reads outside the project

`filesystem.outsideProject.read` is `"allow"` (default), `"ask"` or `"deny"`, with `filesystem.outsideProject.allowRead` for roots that never ask. Both layers enforce it. Layer 2 prompts (or blocks headless). Layer 1 fences the home dir for `bash`; because the OS layer cannot prompt mid-command, `"ask"` pre-flights the command (ADR-015): if it plainly names an outside path, you are prompted **before** it runs — `yes — this once` runs it once without saving, the `always` options persist the grant, and deny means the command does not run and you get an explicit refusal, never a silently trimmed listing. The pre-flight parses the shell rather than a short list of command names (ADR-045): shell wrappers (`sh -c`, `sudo`, `env`, `xargs`), command substitutions, globs (`cat .e*`), interpreter arguments (`node -e "…'.env'…"`) and folders named by a recursive search (`grep -r KEY .`) all contribute candidates. A path built at runtime (variable expansion, a compiled helper, a script file) is still invisible to it and falls back to the fence. The `always` rows are only offered when the command itself names the path; a grant target recovered from error output can be allowed once or for the conversation, never saved (ADR-046), and protected folders (`~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.pi`, `~/.config`, system dirs) are never offered as folder grants. The project, `allowWrite` roots, `outsideProject.allowRead` and pi's own package never ask — but `~/.pi/agent` is **not** exempt as a whole (it is in the default `denyRead`; `auth.json` stays absolute-denied), which is why `outsideProject.allowRead` explicitly re-allows `~/.pi/agent/install` and `~/.pi/agent/npm`. In interactive sessions a read of a path the user named in full (`/…` or `~/…`) in their own message runs once without a prompt (audited as `user-named`). If you need a file outside the project, name its full path when you ask the user, so their reply unlocks it. Headless runs block outside reads unless `allowRead` covers them.

## Ask-tier prompt options

When a normal (non-absolute-deny) call is blocked:
- **no — block** — hard deny (default, pre-selected)
- **yes — this once** — allow just this call
- **yes — for this conversation** — this file, its parent folder, or this domain until the conversation ends; not saved
- **always for CURRENT project** — whitelist this file in `<cwd>/.pi/sandbox.json`
- **always for CURRENT project (folder)** — whitelist the parent directory
- **always for ALL projects** — whitelist in `~/.pi/agent/extensions/sandbox.json`
- **always for ALL projects (folder)** — whitelist parent directory globally

A **network** (domain) ask keeps the same rows, but the *unanswered* default flips (ADR-024): the footer reads `Default: Yes, just this once (15s)`, and a countdown that runs out counts as **allow once for this bash command**. `No` is still preselected (Enter blocks) and Esc still denies. A domain in `deniedDomains` (or `network.strictAllowlist: true`) never prompts.

For a Layer 1 bash **write** blocked after the command already ran, `yes — this once` re-runs the command once with the offending path's parent folder allowed for that invocation only (never saved); the same folder is not offered again within that invocation, and `denyWrite` still wins over the grant. A write the pre-flight can see before it runs (`> .env`, `tee`, `cp x .env`, `sed -i .env`) is a hard block when it matches `denyWrite` and an `askWrite` prompt otherwise. The block is recognized from the error output either way it is reported — `EPERM`/`Operation not permitted` on macOS, `EROFS`/`Read-only file system` on Linux (ADR-022) — and a refused write is never offered as a read grant. If the output never names the operand, there is nothing to attribute and no prompt, so the command is simply refused. When the error text names a path the command itself never mentioned, the prompt keeps the one-off and conversation rows and drops `always`, so fabricated output cannot create a permanent rule (ADR-046).

A bash read pre-flight distinguishes **content** from **name** (ADR-049). `cat`, `grep`, `jq`, `base64` and an interpreter read the bytes and ask for an `askRead` file exactly as before. `find`, `ls`, `tree`, `du` and `stat` only print names: inside the project that does not ask at all (the AI can already list its own files; the run is audited as `ask-read-name-only`), and outside the project it asks with a body that says only the name is exposed. A `find` command is read through find's own grammar — `-name`, `-path`, `-maxdepth`, `-mindepth` bound what it can print, and `-not -name` / `-not -path` exclude — so `find . -name "*.txt"` never asks about `.env`. A heredoc body is data, never a command: writing a script that mentions `find .` does not trigger a credential prompt.

Every prompt waits **15 seconds** by default and shows it live as `Default: … (Ns)` under the body. For file reads/writes no answer means the safe default: **block / deny**, and Esc blocks. For a network ask, an unanswered countdown means **allow once** (Esc still denies) — ADR-024. In the TUI the `Default:` line disappears as soon as you press ↑/↓ and the timer restarts, so the hint never competes with an active choice (ADR-031). The prompt is keyboard-only (ADR-036): ↑/↓ move the highlight, Enter selects, Esc cancels — a mouse click or wheel over the prompt does nothing except scroll the body. A body longer than the terminal (a long command, a wrapped evidence line) scrolls instead of growing: `PgUp/PgDn`, `[`/`]`, Shift+↑/↓, or the wheel move it, and a compact indicator reads `[1–12/58]` (the help line gains `PgUp/PgDn scroll` while the body scrolls). The options and the help line are always kept on screen (ADR-041).

The same options apply to a bash command whose network request reaches a host outside `allowedDomains` (ADR-023), with the countdown default and live footer from ADR-024/ADR-031: `No` / `Yes, just this once` / `Yes, all in group for this conversation` / `Yes, always…`, and an untouched countdown counts as allow-once. Because the sandbox proxy asks per connection, `Allow (default)` covers that bash command rather than one connection — redirects and parallel connections to the same host do not re-prompt. A host in `deniedDomains`, or `network.strictAllowlist: true`, is blocked outright: the prompt never appears. A remembered host is written to `overrides.allowDomains` and takes effect immediately, so the waiting request completes without a retry. Prompts from both layers are serialized through one queue (`src/ui/ask-flow.ts`), so two unknown hosts cannot replace each other's selector and hang the waiting connection.

## Sensitive reads ask

`filesystem.askRead` lists paths that prompt instead of being hard-denied (ADR-019). It takes two kinds of entry: a **file name** without `/` (`.env` matches `<cwd>/.env` and `~/.env`), and a **folder** with `/` or `~/` (`~/.aws` covers every file beneath it, including ones that appear later). The shipped default uses both: the credential file names (`id_rsa*`, `*.pem`, `auth.json`, …) and the credential store folders everyone has (`~/.aws`, `~/.kube`, `~/.docker`, `~/.config/gcloud`). There is deliberately **no per-vendor registry**: a tool with its own folder is one line away (`"~/.any-vendor": "ask"` — see `credentialFolders` examples in `sandbox.example.json`), and the content scan catches what the path list does not.

## Permission modes

`mode` picks how much pi inspects beyond the rules (ADR-018):

- **`default`** (shipped) — rules only. No content inspection.
- **`advanced-secure`** (recommended) — adds secret/credential detection, and **only adds asks or blocks** (never loosens):
  - file reads whose name looks like a credential store ask before the read;
  - risky `mcp__<server>__<tool>` calls ask before they run. The gate ignores the `mcp__<server>__` namespace, takes the operation from the head verb of the name (or the first verb of the description), and asks for destructive names, mutating names (`update_*`, `create_*`, `run_*`, `evaluate_*`), and destructive arguments (SQL `DELETE`/`UPDATE` without `WHERE`, `rm -rf`, `*` targets, HTTP `DELETE`, production targets). A documented tool with an unclassified name (`context`, `capture`, `logs`) does not ask; a tool with **no description** counts as opaque and does. Tune it under `mcp` in `sandbox.json` (ADR-032): `allowTools` / `allowPrefixes` skip asks, `askTools` forces them, `trustAnnotations` lets a server's `readOnlyHint` allow the call, `askThreshold` moves the score line (default 30). An untrusted project file may only tighten it (add `askTools`, lower `askThreshold`, turn `allowSimpleUpdates`/`trustAnnotations` off).
  - before any tool/command/file output reaches the model, a secret-like hit shows the tool and each detected line as `Finding  <lineNo>: <line>`, **complete and untruncated** — one row per detected line, however long it is (a `ps aux` row, a minified bundle). The prompt body never clips and never caps; instead it is a viewport over the wrapped rows (`PgUp/PgDn`, `[`/`]`, Shift+↑/↓, wheel, with a `[1–12/35]` indicator), so you scroll to read the whole line while the question, the note, the choices and the help line stay on screen — those are fixed rows, only the evidence moves (ADR-041, ADR-042, ADR-043). A hit that is whole-content rather than line-level (a query-string credential, a PEM block that redaction removed) falls back to the finding label instead, so the prompt never appears with no evidence. Then `Question Should the AI be allowed to see it?`, with two choices — **No, keep private** or **Yes, allow**. No, keep private hides the output and tells the model it was hidden because it may contain sensitive credentials (not a failure, not an empty result).

Switch with `/permission-mode`; all three modes are saved to the global `sandbox.json` and reflected in the footer's sandbox chip (`Sandbox: 🧠 N domains, M paths` for advanced-secure, `Sandbox: 🔒 …` for default). An untrusted project may move the mode **up** (toward stricter), never down: it cannot turn on YOLO or turn off Advanced Secure. The third choice, **YOLO**, disables every layer; the chip reads `⚠️ YOLO — all security layers disabled` until you pick another mode (ADR-020).

## Commands

- `/security` — show Layer 2 status, effective policy, and last 10 audit events
- `/sandbox` — show Layer 1 bash sandbox config
- `/sandbox reload` — live-reload sandbox after manual `sandbox.json` edits
- `/permission-mode` — choose Default (rules), Advanced Secure (secret detection), or YOLO (all layers off). Saved to the global `sandbox.json`.

## Escape hatches

```bash
pi --yolo          # disables ALL layers
pi --no-sandbox    # alias for --yolo
```

Without restarting, `/permission-mode` → **YOLO** turns every layer off in one pick; it is saved to the global `sandbox.json` like the other modes, and picking Default or Advanced Secure turns them back on in place (ADR-020). `pi --yolo` is a per-run flag and writes nothing. Setting `"enabled": false` in `sandbox.json` disables Layer 2 without disabling Layer 1.

## When a policy file does not parse

`sandbox.json` is strict JSON. One trailing comma makes both layers skip the whole file and fall back to the built-in defaults. Layer 2 reports this at session start ("does not parse, so neither layer applies its rules") and writes `policy-parse-error` to the audit log. If a user reports that their rules have no effect, check this first: `node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' <file>`. The "always" prompts refuse to write to an unparseable file.

## Audit log

`~/.pi/agent/audit.log` — append-only JSONL, one entry per decision.

## Common tasks

**Allow a new domain** — either answer "always" in the prompt when the block fires (from a bash command or a URL tool), or add it manually:
```json
// ~/.pi/agent/extensions/sandbox.json  (global)
// or <cwd>/.pi/sandbox.json  (project-local)
{ "overrides": { "allowDomains": ["api.example.com"] } }
```

**Allow writes to a new path** — same pattern with `allowWrite`.

**Allow an MCP tool** — in Advanced Secure mode, a `mcp__<server>__<tool>` call that keeps asking can be allowed without weakening anything else:
```json
// ~/.pi/agent/extensions/sandbox.json  (global)
{ "mcp": { "allowPrefixes": ["mcp__ticktick__get_"], "allowTools": ["mcp__diffusion_studio__export"] } }
```
`allowTools` matches exact names, `allowPrefixes` matches the start (case-insensitive). Detected destructive calls still ask unless an exact `allowTools` entry names them. `"trustAnnotations": true` lets servers that mark a tool `readOnlyHint` skip the ask, and a project's `mcp` file may only tighten (add `askTools`, lower `askThreshold`, turn `allowSimpleUpdates`/`trustAnnotations` off) until you trust it.

**View recent blocks** — run `/security` and read the audit section, or:
```bash
tail -20 ~/.pi/agent/audit.log | python3 -m json.tool
```

**Disable every layer** — for one run: `pi --yolo` or `pi --no-sandbox`. Persistently: `/permission-mode` → YOLO (saved to the global `sandbox.json`, like the other modes).
