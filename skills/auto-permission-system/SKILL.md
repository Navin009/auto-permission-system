---
name: auto-permission-system
description: Use this skill when the user asks about the auto-permission-system extension, security policy configuration, why a tool call was blocked, how to add an allow-list entry, or how to configure sandbox behavior. Covers the two-layer sandbox (OS-level bash sandbox and in-process tool guard), policy file locations and fields, ask-tier prompt options, absolute-deny paths, escape hatches (--yolo, --no-sandbox), the audit log, and common tasks like allowing a new domain or write path.
---

# Pi Security — Skill

Use this skill when the user asks about the auto-permission-system extension, security policy configuration, why a tool call was blocked, how to add an allow-list entry, or how to configure sandbox behavior.

## What this extension does

**Layer 1 — Bash sandbox (OS-level)**
Wraps the `bash` tool with `sandbox-exec` (macOS) or `bubblewrap` (Linux). Blocks:
- Filesystem writes outside `allowWrite`
- Filesystem reads of `denyRead` paths (defaults include `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.pi/agent`)
- Filesystem reads outside the project when `outsideProject.read` is `"ask"` or `"deny"` — when set, the home dir (and the project's parent) is fenced with `denyRead` and the project plus `allowWrite`/`outsideProject.allowRead` are re-exposed (ADR-014). With `"ask"`, a bash command that *plainly* names an outside path is confirmed with you **before it runs** (ADR-015): allow (`yes — this once`, or a persistent `always` grant) → the real, complete output; deny → the command is not run at all (no silently trimmed output). `install`/`npm` under `~/.pi/agent` are pre-allowed via `outsideProject.allowRead`, so they never prompt. Obfuscated reads still hit the fence and stay masked.
- Network egress to domains not in `allowedDomains`

**Layer 2 — In-process tool guard**
Hooks `tool_call` for `read`, `grep`, `find`, `ls`, `write`, `edit`, `fetch_content`, `web_search`, `get_search_content`. Applies the same policy file as Layer 1. For `grep`, `find` and `ls` the search root is checked like a `read` path. A `tool_result` hook also removes `grep` output lines from denied files beneath an allowed root (for example a `.env` deep in the tree); approving the root does not approve those files. When a call is blocked, shows an interactive prompt with persistence options.

**Layer 3 — Subagent posture**
When `ctx.hasUI === false` (subagents, `-p`, JSON mode), applies the `subagent.network` policy: `allow` (default) | `deny` | `research-only`.

## Policy files

Merged in order (later wins):
1. `sandbox.default.json` — shipped baseline (`outsideProject.read: "ask"`, full `denyRead`/`denyWrite`, `modelDenyRead`)
2. `~/.pi/agent/extensions/sandbox.json` — global user policy
3. `<cwd>/.pi/sandbox.json` — project-local overrides (also written by ask-tier prompts)

A higher layer only states what it changes; absent keys keep the layer below. A **trusted** project may loosen the baseline; an **untrusted** project may only tighten it (ADR-013). You do not need a global file for good defaults (ADR-016).

## Key policy fields

```jsonc
{
  "enabled": true,
  "mode": "default",                     // "default" (rules) | "advanced-secure" (secret detection, ADR-018)
  "network": {
    "allowedDomains": ["github.com", "*.github.com"],  // empty = allow all
    "deniedDomains": []
  },
  "filesystem": {
    "denyRead": ["~/.ssh", "~/.pi/agent"],  // Layer 1 + 2: hard block (defaults add ~/.aws, ~/.gnupg)
    "askRead": [".env", ".env.*"],  // Layer 1 + 2: ask before reading (ADR-019)
    "modelDenyRead": ["~/.netrc"],    // Layer 2 only: model read blocked, subprocesses ok
    "allowWrite": [".", "/tmp"],      // Layer 2: write only inside these
    "denyWrite": [".env", "*.pem"]   // Layer 1 + 2: always blocked
  },
  "subagent": { "network": "allow" },
  "commands": {
    "ask": ["printenv", "env", "/proc/*/environ"]  // bash: ask before these (they can print env tokens)
  },
  "overrides": {                      // written by ask-tier prompts or manual edits
    "allowRead": [],
    "allowWrite": [],
    "allowDomains": []
  }
}
```

## Absolute-deny tier

Paths matching `~/.ssh`, `~/.gnupg`, `~/.aws`, `*.pem`, `*.key` and pi's own `~/.pi/agent/auth.json` are always high-risk blocks. To allow one call the user picks *allow this ONE call* in a menu that defaults to block, then *Yes* in a second menu that also defaults to No. Enter-Enter blocks. In headless mode these calls are always blocked. The "always" option is never available for these paths.

## Project policy trust

A project `.pi/sandbox.json` applies in full only after the user trusted its exact content with `/security trust` (stored in `~/.pi/agent/extensions/sandbox.trust.json`). Untrusted, only its block rules and stricter settings apply; changes that make security weaker are ignored, and a warning lists them in plain words. A "No" answer stops the warning until the file changes. If a user's project overrides "stopped working", check `/security` ("not trusted") and suggest `/security trust`. Never suggest editing the trust store by hand.

## Reads outside the project

`filesystem.outsideProject.read` is `"allow"` (default), `"ask"` or `"deny"`, with `filesystem.outsideProject.allowRead` for roots that never ask. Both layers enforce it. Layer 2 prompts (or blocks headless). Layer 1 fences the home dir for `bash`; because the OS layer cannot prompt mid-command, `"ask"` pre-flights the command (ADR-015): if it plainly names an outside path (a read-like command such as `ls`, `cat`, `find`, `grep`), you are prompted **before** it runs — `yes — this once` runs it once without saving, the `always` options persist the grant, and deny means the command does not run and you get an explicit refusal, never a silently trimmed listing. Reads the pre-flight cannot see (variable expansion, nested shells, scripts) still fall back to the fence and stay masked. The project, `allowWrite` roots, `outsideProject.allowRead` and pi's own package never ask — but `~/.pi/agent` is **not** exempt as a whole (it is in the default `denyRead`; `auth.json` stays absolute-denied), which is why `outsideProject.allowRead` explicitly re-allows `~/.pi/agent/install` and `~/.pi/agent/npm`. In interactive sessions a read of a path the user named in full (`/…` or `~/…`) in their own message runs once without a prompt (audited as `user-named`). If you need a file outside the project, name its full path when you ask the user, so their reply unlocks it. Headless runs block outside reads unless `allowRead` covers them.

## Ask-tier prompt options

When a normal (non-absolute-deny) call is blocked:
- **no — block** — hard deny (default, pre-selected)
- **yes — this once** — allow just this call
- **yes — for this session** — this file, its parent folder, or this domain until the session ends; not saved
- **always for CURRENT project** — whitelist this file in `<cwd>/.pi/sandbox.json`
- **always for CURRENT project (folder)** — whitelist the parent directory
- **always for ALL projects** — whitelist in `~/.pi/agent/extensions/sandbox.json`
- **always for ALL projects (folder)** — whitelist parent directory globally

Every prompt waits **10 seconds** by default; no answer means the safe default: **block / deny**. Esc on any screen also blocks.

## Sensitive reads ask

`filesystem.askRead` lists paths that prompt instead of being hard-denied (ADR-019). Shipped default: `.env`, `.env.*`. Both layers ask — the `read` tool in `tool_call`, and the bash pre-flight before a command that plainly reads the file. Esc / 10s timeout blocks; headless blocks. `denyRead` wins over `askRead` (a path in both is denied), and the credential tier stays hard.

## Permission modes

`mode` picks how much pi inspects beyond the rules (ADR-018):

- **`default`** (shipped) — rules only. No content inspection.
- **`advanced-secure`** — adds secret/credential detection, and **only adds asks or blocks** (never loosens):
  - file reads whose name looks like a credential store ask before the read;
  - risky `mcp__<server>__<tool>` calls ask before they run;
  - before any tool/command/file output reaches the model, a secret-like hit shows the file and each detected line as `lineNo: text`, with two choices — **No, keep private** or **Yes, allow**. No, keep private withholds the output and tells the model it was withheld because it may contain sensitive information (not a failure, not an empty result).

Switch with `/permission-mode`; the choice is saved to the global `sandbox.json` and reflected in the footer's sandbox chip (`Sandbox: ☢️ N domains, M paths` for advanced-secure, `Sandbox: 🛡️ …` for default). An untrusted project may turn `advanced-secure` **on**, never off.

## Commands

- `/security` — show Layer 2 status, effective policy, and last 10 audit events
- `/sandbox` — show Layer 1 bash sandbox config
- `/sandbox reload` — live-reload sandbox after manual `sandbox.json` edits
- `/permission-mode` — choose Default (rules) or Advanced Secure (secret detection)

## Escape hatches

```bash
pi --yolo          # disables ALL layers
pi --no-sandbox    # alias for --yolo
```
Setting `"enabled": false` in `sandbox.json` disables Layer 2 without disabling Layer 1.

## When a policy file does not parse

`sandbox.json` is strict JSON. One trailing comma makes both layers skip the whole file and fall back to the built-in defaults. Layer 2 reports this at session start ("does not parse, so neither layer applies its rules") and writes `policy-parse-error` to the audit log. If a user reports that their rules have no effect, check this first: `node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' <file>`. The "always" prompts refuse to write to an unparseable file.

## Audit log

`~/.pi/agent/audit.log` — append-only JSONL, one entry per decision.

## Common tasks

**Allow a new domain** — either answer "always" in the prompt when the block fires, or add it manually:
```json
// ~/.pi/agent/extensions/sandbox.json  (global)
// or <cwd>/.pi/sandbox.json  (project-local)
{ "overrides": { "allowDomains": ["api.example.com"] } }
```

**Allow writes to a new path** — same pattern with `allowWrite`.

**View recent blocks** — run `/security` and read the audit section, or:
```bash
tail -20 ~/.pi/agent/audit.log | python3 -m json.tool
```

**Disable for one session** — `pi --yolo` or `pi --no-sandbox`.
