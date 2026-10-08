# auto-permission-system

[![npm version](https://img.shields.io/npm/v/auto-permission-system.svg)](https://www.npmjs.com/package/auto-permission-system)
[![npm downloads](https://img.shields.io/npm/dm/auto-permission-system.svg)](https://www.npmjs.com/package/auto-permission-system)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Pi package](https://img.shields.io/badge/pi--package-gallery-blueviolet)](https://pi.dev/packages)
[![CI](https://github.com/Navin009/auto-permission-system/actions/workflows/ci.yml/badge.svg)](https://github.com/Navin009/auto-permission-system/actions/workflows/ci.yml)

**A security sandbox, permission system and tool guard for the [Pi coding agent](https://pi.dev).**
It puts allow/deny rules, interactive ask prompts, secret detection and an audit log around every tool the agent can call — file reads and writes, shell commands, searches and network access — so the agent can work in your repository without reaching your credentials or the wider internet by accident.

Enforcement happens in three layers:

- **Layer 1** — OS-level bash sandbox (`sandbox-exec` on macOS, `bubblewrap` on Linux) that blocks filesystem writes outside an allow-list, reads of sensitive paths, reads outside the project when `outsideProject.read` gates them, and network egress to unlisted domains — an unknown host asks first (a host in `deniedDomains` never does), with the same once/session/remember options as Layer 2.
- **Layer 2** — In-process tool guard applying the same policy to the tools the OS sandbox can't reach: `read`, `grep`, `find`, `ls`, `write`, `edit`, `fetch_content`, `web_search`, `get_search_content`. `grep` output lines from denied files beneath an allowed search root are removed before the model sees them.
- **Layer 3** — Subagent posture: optionally drop or restrict network access when running headless (`-p`, JSON mode, subagents).

When a tool call is blocked you get an interactive prompt — no need to leave pi and hand-edit config files. Choose *this once*, *always for this project*, or *always for all projects* (file or parent-folder granularity). Decisions are persisted and audited.

## Contents

- [Install](#install)
- [Requirements](#requirements)
- [Configuration](#configuration)
- [Commands](#commands)
- [Escape hatches](#escape-hatches)
- [FAQ](#faq)
- [Audit log](#audit-log)
- [Development](#development)
- [Releasing](#releasing)
- [License](#license)

## Install

`auto-permission-system` is a [Pi package](https://pi.dev/packages), so it installs with `pi install` from npm or git:

```bash
# From npm (recommended)
pi install npm:auto-permission-system

# From git
pi install git:github.com/Navin009/auto-permission-system

# Try it for one run, without installing
pi -e npm:auto-permission-system
```

Browse it on the [Pi package gallery](https://pi.dev/packages). Installing from npm pins the released version; `pi update --extensions` reconciles to the latest.

## Requirements

- macOS or Linux
- macOS: `sandbox-exec` is built in
- Linux: `bubblewrap`, `socat`

## Configuration

Policy files are merged in order:

| File | Scope |
| ---- | ----- |
| `sandbox.default.json` (shipped in this package) | Baseline — used when no other file overrides it |
| `~/.pi/agent/extensions/sandbox.json` | Global (all projects) |
| `<cwd>/.pi/sandbox.json` | Project-local (auto-written by ask-tier prompts) |

A higher layer only states what it changes; absent keys keep the layer below. A **trusted** project may loosen the baseline; an **untrusted** project (ADR-013) may only tighten it. You do **not** need a global file: the shipped default already turns on the project boundary (`outsideProject.read: "ask"`), the credential `modelDenyRead` list and the full `denyRead` / `denyWrite` lists. Copy `sandbox.example.json` only when you want to start customising.

### Key fields

```jsonc
{
  "enabled": true,                      // set false to disable Layer 2 without --yolo
  "mode": "default",                   // "default" (rules) | "advanced-secure" (secret detection, ADR-018)
  "network": {
    "allowedDomains": [                 // domains the URL tools and bash may reach
      "github.com", "*.github.com",
      "registry.npmjs.org"
    ],
    "deniedDomains": [],                // hard deny, checked first, never ask-able
    "strictAllowlist": false            // true = deny unknown hosts instead of asking
  },
  "filesystem": {
    "denyRead": ["~/.ssh", "~/.aws", "~/.pi/agent"],  // Layer 1 + Layer 2: no read at all
    "askRead": [".env", ".env.*"],    // Layer 1 + Layer 2: ask before reading, not hard-denied (ADR-019)
    "modelDenyRead": ["~/.netrc"],      // Layer 2 only: model's read tool blocked; subprocesses ok
    "allowWrite": [".", "/tmp"],        // Layer 2: writes only inside these roots
    "denyWrite": [".env", "*.pem"]     // Layer 1 + Layer 2: write always blocked
  },
  "subagent": {
    "network": "allow"                  // "allow" | "deny" | "research-only"
  },
  "commands": {
    "ask": ["printenv", "env", "/proc/*/environ"]  // bash: ask before these (they can print env tokens)
  }
}
```

### Project policy files and trust

A folder can have its own `.pi/sandbox.json`. It comes with the folder, for example with a repository that you clone. So auto-permission-system does not trust it automatically (ADR-013).

- **Block rules in the file always apply.** They are added to your rules.
- **Changes that make your security weaker do not apply** until you trust the file. Examples: turn off auto-permission-system, let bash write to `/`, allow more websites.
- auto-permission-system shows a warning that lists these changes in plain words.
- **Did you write the file?** Type `/security trust`. auto-permission-system shows the changes and asks you. If you say "No", it does not warn again until the file changes.
- Trust is for the file as it is now. If the file changes, auto-permission-system asks again.
- Most folders have no `.pi/sandbox.json`, so you see nothing. Your own "always for CURRENT project" answers keep the file trusted.
- `/security untrust` removes the trust. `/security` shows the status.

### Outside the project

Reads outside the working directory can ask before they run (ADR-012):

```jsonc
"filesystem": {
  "outsideProject": {
    "read": "ask",                       // "allow" (default) | "ask" | "deny"
    "allowRead": ["~/repos", "~/.cargo/registry"]
  }
}
```

Never asked about: the project itself, your `allowWrite` roots, pi's own package (docs, examples) and `allowRead`. `~/.pi/agent` is **not** exempt as a whole: it is in the default `denyRead` (it holds `mcp.json`, which can carry API keys, plus sessions and caches), while `auth.json` stays absolute-denied — add specific paths such as `~/.pi/agent/install` to `outsideProject.allowRead` when a tool must read them without asking. Both layers enforce the boundary. Layer 2 prompts. Layer 1 fences the home directory for `bash` (ADR-014); because the OS layer cannot prompt mid-command, `"ask"` pre-flights the command (ADR-015) — a read-like command that plainly names an outside path (`ls`, `cat`, `find`, `grep`, …) prompts **before** it runs, with `yes — this once` (run without saving) and the persistent `always` options, so **allow returns the complete real output and deny runs nothing** (an explicit refusal, never a silently trimmed listing). Reads the pre-flight can't see (variable expansion, nested shells, scripts) still hit the fence and stay masked. In an interactive session a read runs without a prompt when **you named its full path** (`/…` or `~/…`) in one of your own messages; only messages you typed count, never tool output or the agent's text. Otherwise you get the ask-tier prompt, including `yes — for this session`. Headless runs block (set `allowRead` for paths a harness needs). Writes outside the project are governed by `allowWrite` as before.

### Ask-tier prompt

`no — block` is pre-selected, so Enter alone blocks. **Network (domain) asks are the exception** (ADR-024): the countdown default is `Allow once` — the footer reads `Default: Yes, just this once (15s)` — so an unanswered countdown counts as allow-once for that bash command, while Enter and Esc still block/deny. Once you press ↑/↓ the `Default:` line disappears and the 15s activity timer restarts (ADR-031). Besides `yes — this once` and the persistent `always` options there is `yes — for this session` (this file, its folder, or this domain), kept in memory until the session ends and never saved (ADR-010). A bash command that reaches a domain outside `allowedDomains` gets the same prompt (ADR-023); because the sandbox proxy asks per connection, `yes — this once` covers that command's connections to the host, and a remembered host is written to `overrides.allowDomains` and applies immediately. Hosts in `deniedDomains`, or with `strictAllowlist: true`, are blocked without a prompt. Prompts are shown one at a time: the extension serializes them, because pi's selector is a singleton and two overlapping prompts can orphan each other and hang the waiting connection. For a bash write that the sandbox refused after the command already ran, `yes — this once` re-runs the command once with that folder allowed for the one invocation only (never saved), and `denyWrite` still wins. The refusal is read from the command's own error text — `EPERM` / `Operation not permitted` on macOS, `EROFS` / `Read-only file system` on Linux (ADR-022) — so a Linux EROFS gets the same prompt instead of a silent read-only failure; a refused write is never mistaken for an outside-project read.

Every prompt waits **10 seconds** by default. For file reads and writes, no answer resolves to the safe default: **block / deny**. For a network ask, no answer resolves to **allow once** (ADR-024); Esc still denies.

### File-name patterns

An entry without `/` or `~` (`.env`, `*.key`) is a file name. pi's own tools (Layer 2) match it anywhere on disk; bash (Layer 1) matches it anywhere under the project directory, so `packages/api/.env` is covered too. Use a full path (`~/other/.env`) to cover a file outside the project for bash.

### Permission modes

`mode` selects how much pi inspects, on top of the rules:

- **`default`** (shipped) — rules only: sandbox.json paths, domains, and commands. Nothing inspects file contents.
- **`advanced-secure`** (recommended) — adds secret/credential detection:
  - **File reads:** a filename that looks like a credential store asks before the read.
  - **MCP calls:** `mcp__<server>__<tool>` calls are classified; a risky (mutating/destructive) call asks before it runs.
  - **Tool/command/file output:** before any output reaches the model, a secret-like hit shows `⚠ Sensitive information detected`, the file, and each detected line as `lineNo: text`, and the question **Should the AI be allowed to see it?** with two choices — **No, keep private** or **Yes, allow**. A bare `key` counts only when the value looks machine-generated: `key=<random>` asks, while `key=value`, `key=subagent.network`, and code such as `const key = x` stay clean. No, keep private withholds the output and tells the model plainly that the output was withheld because it may contain sensitive information, so the model does not mistake it for a failure or an empty result. Esc or timeout keeps it private.

Detection can only **add** asks or blocks; it never loosens a rule. The mode is layered like every other key: an untrusted project may opt *in* to `advanced-secure`, but only a trusted project (or the global file) may turn it off.

Change it with `/permission-mode`; `default` / `advanced-secure` are saved to the global `sandbox.json` and reflected in the footer's single sandbox chip: `Sandbox: 🧠 N domains, M paths` for `advanced-secure`, `Sandbox: 🔒 N domains, M paths` for `default`.

The third choice, **YOLO**, turns every layer off. It is a persisted mode like the others — `setPolicyMode()` writes `mode: "yolo"` to the global `sandbox.json`, so the next session starts that way too. The chip reads `⚠️ YOLO — all security layers disabled`, and it is one pick in the same menu. Pick `Default` or `Advanced Secure` to turn the layers back on (ADR-020).

### Commands that print secrets

Bash commands that dump the environment can print the API tokens pi runs on. `commands.ask` lists them, and Layer 1 asks before running one (`Block` / `Allow once`); deny runs nothing (ADR-017). An entry without `/` is a command name (matched on the head of each `;`/`&&`/`|` segment); an entry with a path is globbed against every path token, so any reader of the per-process environ file is caught. The shipped default is `["printenv", "env", "/proc/*/environ"]`.

### Sensitive reads ask by default

`askRead` lists paths that **prompt** instead of being hard-denied (ADR-019). The shipped default asks for `.env` and `.env.*`, in both layers: the model's `read` tool asks, and the bash pre-flight asks before a command that plainly reads the file. No answer (Esc or the 10s timeout) blocks, and headless runs block. `denyRead` still wins over `askRead`, so put a path in `denyRead` to hard-deny it. The credential tier (`~/.ssh`, `~/.aws`, `*.pem`, `*.key`, `~/.gnupg`, `auth.json`) stays hard.

### Absolute-deny tier

Access to `~/.ssh`, `~/.gnupg`, `~/.aws`, `*.pem`, `*.key` and pi's own `~/.pi/agent/auth.json` is always a high-risk block. Allowing one call takes two menus, each with "block" pre-selected: pick *allow this ONE call*, then confirm with *Yes*. Pressing Enter twice blocks. The "always" option is never offered (ADR-009).

### A policy file that does not parse

`sandbox.json` is strict JSON: no comments, no trailing commas. If a file does not parse, both layers skip it and use the built-in defaults for it. Layer 2 then shows an error at session start and writes `policy-parse-error` to the audit log. The "always" prompts refuse to write to a file they cannot parse, so a hand-written policy is never replaced.

## Commands

| Command | Description |
|---------|-------------|
| `/security` | Show Layer 2 policy, project-local overrides, last 10 audit events |
| `/sandbox` | Show Layer 1 (bash sandbox) config |
| `/sandbox reload` | Live-reload sandbox after manual edits to `sandbox.json` |
| `/permission-mode` | Choose the permission mode: Default (rules), Advanced Secure (secret detection), or YOLO (all layers off). Saved to the global `sandbox.json`. |

## Escape hatches

```bash
pi --yolo          # disables ALL layers globally (visible warning banner)
pi --no-sandbox    # alias for --yolo
```

Mid-session, `/permission-mode` → **YOLO** disables every layer in place (no restart); it is saved to the global `sandbox.json` like the other modes, and choosing Default or Advanced Secure brings the layers back (ADR-020). `pi --yolo` remains a per-run flag and writes nothing.

## Audit log

Every block/allow/always decision is appended to `~/.pi/agent/audit.log` as a JSON line:

```jsonc
{
  "ts": "2026-07-15T10:00:00.000Z",
  "layer": 2,
  "tool": "write",
  "subject": "/Users/you/project/secret.pem",
  "reason": "denyWrite matched \"*.pem\"",
  "decision": "no",
  "cwd": "/Users/you/project"
}
```

## FAQ

### How do I allow the agent to reach a new domain?
Add it to `network.allowedDomains` in a policy file (global `~/.pi/agent/extensions/sandbox.json` or project `<cwd>/.pi/sandbox.json`), or just run the tool (or a bash `curl`) once and pick an **always** option in the ask prompt — that writes the domain to the project file for you.

### How do I allow writes to another folder?
Add the folder to `filesystem.allowWrite`. Relative paths (`.`, `/tmp`) resolve from the project root.

### Why was my tool call or command blocked?
Run `/security` to see the active Layer 2 policy and the last 10 audit events; run `/sandbox` for the Layer 1 bash sandbox config. The audit log at `~/.pi/agent/audit.log` records the rule that matched (`reason`).

### How do I turn the sandbox off temporarily?
`pi --yolo` (alias `--no-sandbox`) for a single run, or `/permission-mode` → **YOLO** mid-session. YOLO is persisted like the other modes; pick Default or Advanced Secure to re-enable the layers.

### Why does `.env` (or my SSH key) get flagged while other files do not?
`.env` and `.env.*` are in the shipped `askRead` list, so reads **prompt** by default. The absolute-deny tier (`~/.ssh`, `~/.gnupg`, `~/.aws`, `*.pem`, `*.key`, pi's `auth.json`) always needs a two-step confirmation. Add paths to `denyRead` to hard-deny, or to `askRead` to prompt instead of block.

### How is this different from just using `--yolo`?
`--yolo` removes every guard for one run. `auto-permission-system` is the guard: it decides what runs, prompts when it is unsure, and records the decision. Use `/permission-mode` to switch between **Default** (rules only), **Advanced Secure** (rules + secret/credential detection, recommended) and **YOLO**.

### Does it work on Windows?
No. Layer 1 needs `sandbox-exec` (macOS, built in) or `bubblewrap` + `socat` (Linux). Layer 2 is platform-independent.

### Where do the prompts persist my answers?
Project answers go to `<cwd>/.pi/sandbox.json`; global answers go to `~/.pi/agent/extensions/sandbox.json`. Session-only grants live in memory and are never written to disk.

## Development

```bash
git clone https://github.com/Navin009/auto-permission-system
cd auto-permission-system
npm install          # installs typescript for typecheck
npm run typecheck    # type-checks against pi's bundled .d.ts files
pi -e .              # load extension for the current session only
```

## Releasing

Releases are fully automated with [semantic-release](https://semantic-release.gitbook.io/), driven by [Conventional Commits](https://www.conventionalcommits.org/) on `main`:

- `fix: ...` → patch release
- `feat: ...` → minor release
- `feat!: ...` or a `BREAKING CHANGE:` footer → major release
- `chore:`, `docs:`, `refactor:`, `test:`, `ci:` etc. → no release by themselves

Commit messages on pull requests are checked by `commitlint` (`.github/workflows/commitlint.yml`). On every push to `main`, `.github/workflows/release.yml` runs `semantic-release`, which:

1. Determines the next version from commits since the last release.
2. Generates release notes and prepends them to `CHANGELOG.md`.
3. Creates the `vX.Y.Z` git tag and GitHub release.
4. Bumps `package.json` and commits `CHANGELOG.md`/`package.json` back to `main` (`chore(release): ... [skip ci]`).
5. Publishes to npm (`npm publish --provenance`) — **only when the repository variable `NPM_PUBLISH` is `true`**.

npm publishing is opt-in (`npmPublish: process.env.NPM_PUBLISH === 'true'` in `.releaserc.cjs`, wired through `.github/workflows/release.yml`), and the GitHub plugin runs before the npm plugin so a failing registry publish can never stop the GitHub Release from being created.

See **[PUBLISHING.md](https://github.com/Navin009/auto-permission-system/blob/main/PUBLISHING.md)** for the full first-publish and npm Trusted Publishing checklist, and for how the package becomes searchable on the [Pi package gallery](https://pi.dev/packages). Nothing is needed locally beyond writing conventional commit messages — just merge to `main`.

## License

MIT
