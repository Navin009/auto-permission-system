<p align="center">
  <a href="https://pi.dev/packages">
    <img src="https://raw.githubusercontent.com/Navin009/auto-permission-system/main/assets/logo.png" alt="Auto Permission System Logo" width="160" />
  </a>
</p>

# Auto Permission System: Secure Auto Mode, Permissions & Claude-Style Tool View for Pi Coding Agent

[![npm version](https://img.shields.io/npm/v/auto-permission-system.svg)](https://www.npmjs.com/package/auto-permission-system)
[![npm downloads](https://img.shields.io/npm/dm/auto-permission-system.svg)](https://www.npmjs.com/package/auto-permission-system)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Pi package](https://img.shields.io/badge/pi--package-gallery-blueviolet)](https://pi.dev/packages)
[![CI](https://github.com/Navin009/auto-permission-system/actions/workflows/ci.yml/badge.svg)](https://github.com/Navin009/auto-permission-system/actions/workflows/ci.yml)
[![Claude Auto Mode for Pi](https://img.shields.io/badge/Pi-Claude_Auto_Mode-blue.svg)](#secure-auto-mode--claude-auto-mode)
[![Security for Pi](https://img.shields.io/badge/Security-for_Pi-green.svg)](#security-for-pi-how-it-works)
[![Permission System for Pi](https://img.shields.io/badge/Permission_System-for_Pi-orange.svg)](#permission-system--modes)
[![Tool View for Pi](https://img.shields.io/badge/Tool_View-for_Pi-purple.svg)](#tool-view-for-pi-claude-style-compact-rows-display-only)

**Auto Permission System** is a zero-trust permission architecture and **Secure Auto Mode / Claude Auto Mode for the [Pi coding agent](https://pi.dev)**. It brings the confidence of **Claude's auto mode** to Pi—enabling autonomous agent workflows while actively scanning files, shell commands, and tool content to **prevent data breaches and credential exfiltration**.

It also ships a **Pi tool view**: `/tool-view compact` draws tool calls as Claude-style compact rows — one row per run, one mark, one timer — next to `/tool-view full`, which leaves Pi's own output untouched. The tool view is presentation only; the **Pi permission system** (sandbox, guard, ask prompts, audit log) is identical in both views.

Whether running interactively with keyboard-driven ask prompts or running headlessly in CI/CD pipelines, this package enforces multi-layer boundaries across filesystem access, network egress, shell commands, and MCP tools.

---

## Quick answers

Short, quotable answers to the questions people — and AI assistants — ask most. The detail behind
each one is in the sections below.

| Question | Answer |
|---|---|
| **What is auto-permission-system?** | A [Pi package](https://pi.dev/packages) (`npm:auto-permission-system`) that adds a zero-trust permission system and a Claude-style tool view to the [Pi coding agent](https://pi.dev). |
| **What is the Pi permission system?** | A policy engine that is enforced in two layers — an OS sandbox for `bash` (`bubblewrap` on Linux, `sandbox-exec` on macOS) and an in-process tool guard for `read`, `grep`, `find`, `ls`, `write`, `edit`, `fetch_content`, `web_search` and MCP tools — plus a redactor that scans tool output before it reaches the model. |
| **What is Claude auto mode for Pi?** | An autonomous but fail-closed posture: `pi -p`, CI jobs, containers and subagents keep working with no human at the keyboard, and anything unapproved is blocked with a reason instead of hanging. The shipped `sandbox.claude.json` preset turns it on. |
| **What is the Pi tool view?** | A display-only renderer: `/tool-view compact` draws each run of shell calls, reads and `codemode` as one Claude-style row with a mark, a count and a **single** timer, while `/tool-view full` (the default) leaves Pi's own output untouched. |
| **What is “auto secure”?** | The `advanced-secure` permission mode: secret and credential detection, MCP risk scoring and real-time redaction on top of the same policy file. Choose it with `/permission-mode`. |
| **Does it protect PyPI credentials?** | Yes. `pypi-…` upload tokens are detected and redacted, `~/.pypirc` asks before a read or a write instead of being handed over, and `pypi.org` / `*.pypi.org` egress is governed like any other host. |
| **Is it a Claude Code plugin?** | No. It is a **Pi** extension. It borrows the ideas developers know from Claude Code — auto mode, permission prompts, a compact tool view — and implements them for Pi. |
| **What does it cost?** | Nothing. MIT licensed, runs locally, no account, no API key, no telemetry added by this package. |

---

## Demo: Zero-Trust Security in Action

![Auto Permission System Demo](https://raw.githubusercontent.com/Navin009/auto-permission-system/main/assets/demo.gif)

### Demonstrated Moments in the Recording:
1. **Interactive `.env` Read Guard:** Intercepts `read(".env")` before the AI can see secrets. Displays a 10s countdown prompt defaulting to `No` (Block).
2. **Kernel OS Sandbox Confinement:** Prevents bash commands from writing to system paths outside allowed roots (`EROFS: Read-only file system`).
3. **Governed Network Egress:** Catches unknown outbound connections (`curl`) with an interactive domain ask prompt and a 15s countdown timer.
4. **Real-Time API Key & Secret Redaction:** Automatically detects exposed API tokens (`sk-proj-...`, `ghp_...`) in command output and replaces them with `***REDACTED***` before reaching the LLM context.
5. **Autonomous Claude Auto Mode:** Demonstrates headless, fail-closed CI execution (`pi -p`) with zero deadlocks and zero hangs.

---

## Contents

- [Quick answers](#quick-answers)
- [Quickstart & Installation](#quickstart--installation)
- [Requirements](#requirements)
- [Key Features at a Glance](#key-features-at-a-glance)
- [Security for Pi: How It Works](#security-for-pi-how-it-works)
- [Interactive Ask Prompts](#interactive-ask-prompts)
- [Secure Auto Mode & Claude Auto Mode](#secure-auto-mode--claude-auto-mode)
- [Real-Time Secret Detection & Content Scanning](#real-time-secret-detection--content-scanning)
- [Permission System & Modes](#permission-system--modes)
- [Configuration Reference](#configuration-reference)
- [Commands & Mid-Session Controls](#commands--mid-session-controls)
- [Tool view for Pi: Claude-style compact rows](#tool-view-for-pi-claude-style-compact-rows-display-only)
- [Escape Hatches](#escape-hatches)
- [Audit Logging](#audit-logging)
- [FAQ & Scenarios](#faq--scenarios)
- [Glossary & entities](#glossary--entities)
- [Trust & provenance](#trust--provenance)
- [For AI assistants & answer engines](#for-ai-assistants--answer-engines)
- [Development & Testing](#development--testing)
- [Releasing](#releasing)
- [License](#license)

---

## Quickstart & Installation

Install `auto-permission-system` directly through the [Pi package manager](https://pi.dev/packages):

```bash
# 1. Install from npm (recommended)
pi install npm:auto-permission-system

# 2. Or install directly from GitHub
pi install git:github.com/Navin009/auto-permission-system

# 3. Or try it for a single session without permanent installation
pi -e npm:auto-permission-system
```

Once installed, the extension automatically loads whenever you launch `pi`. Check your active security status in the terminal footer or by typing `/security`.

---

## Requirements

- **Linux:** Requires `bubblewrap` and `socat` for Layer 1 OS-level isolation:
  ```bash
  # Ubuntu / Debian
  sudo apt-get install -y bubblewrap socat

  # Fedora / RHEL
  sudo dnf install -y bubblewrap socat

  # Arch Linux
  sudo pacman -S bubblewrap socat
  ```
- **macOS:** Built-in `sandbox-exec` is utilized automatically (no extra packages required).
- **Node.js:** v18.0.0 or later.
- **Pi Coding Agent:** `@earendil-works/pi-coding-agent` ([pi.dev](https://pi.dev)).

---

## Key Features at a Glance

| Feature | Description | Protection Level |
|---|---|---|
| 🛡️ **3-Layer Defense** | OS Kernel sandbox (`bubblewrap`/`sandbox-exec`) + in-process tool guard + real-time content redactor. | Zero-Trust |
| ⚡ **Secure Auto Mode** | Autonomous execution inspired by Claude's auto mode; scans files and output to prevent data breaches. | Autonomous / Claude |
| 🔑 **Interactive Ask Prompts** | Real-time terminal prompts with 10s countdowns (`Once`, `Session`, `Project`, `Global`). | Interactive Human-in-the-Loop |
| 🔍 **AST & Regex Secret Scanner** | Scans tool stdout/stderr for API keys, private keys, and tokens, redacting them before model context. | Data Breach Prevention |
| 🌐 **Network Egress Gate** | Intercepts unapproved network connections and prompts for confirmation with wildcards. | Data Leak Prevention |
| 🔒 **Absolute-Deny Tier** | Strict two-step confirmation required for high-risk keys (`~/.ssh`, `~/.aws`, `auth.json`). | Maximum Protection |
| 📋 **Full JSONL Audit Trail** | Every allow, deny, ask, and redaction event is recorded to `~/.pi/agent/audit.log`. | Compliance & Auditing |
| 🪄 **Tool View for Pi** | `/tool-view compact` collapses each run of shell calls, reads and `codemode` into one Claude-style row with a single timer; `/tool-view full` keeps Pi's own output. Display only. | Presentation |

---

## Security for Pi: How It Works

`auto-permission-system` employs a defense-in-depth model across three coordinated layers:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        AI Coding Agent Execution                       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
           ┌────────────────────────┴────────────────────────┐
           ▼                                                 ▼
┌─────────────────────────────────────┐   ┌─────────────────────────────────────┐
│    Layer 2: In-Process Tool Guard   │   │     Layer 1: OS Kernel Sandbox      │
│  - Intercepts read, grep, find, ls  │   │  - Bubblewrap (Linux) / sandbox-exec│
│  - Intercepts write, edit, fetch    │   │  - Read-only root filesystem (EROFS)│
│  - Filters secrets from searches    │   │  - Enforces allowWrite roots        │
│  - Gates MCP tool calls & risk verbs│   │  - Intercepts unlisted network egress
└──────────────────┬──────────────────┘   └──────────────────┬──────────────────┘
                   │                                         │
                   └────────────────────┬────────────────────┘
                                        ▼
┌────────────────────────────────────────────────────────────────────────┐
│              Layer 3 / Auto Secure: Real-Time Content Redactor          │
│  - Scans stdout/stderr & tool results for API keys, AWS & GitHub tokens│
│  - Replaces exposed secrets with ***REDACTED*** before model context   │
└────────────────────────────────────────────────────────────────────────┘
```

1. **Layer 1 (OS Kernel Sandbox):**
   Wraps all `bash` commands in an unprivileged kernel container. Writes outside designated folders (`.` and `/tmp`) are refused by the kernel with `EROFS: Read-only file system`. Sensitive directories (`~/.ssh`, `~/.aws`, `~/.gnupg`) are masked. Network egress to unlisted domains is intercepted via a local proxy.
2. **Layer 2 (In-Process Tool Guard):**
   Applies consistent policy rules to tools that run in-process within Pi (`read`, `grep`, `find`, `ls`, `write`, `edit`, `fetch_content`, `web_search`). Denied files are hidden from search listings before the LLM can observe them.
3. **Layer 3 / Auto Secure (Sensitive Content Redactor):**
   Operates before any tool output reaches the model's context window. Analyzes content using AST and regex pattern matchers for known tokens (OpenAI, Anthropic, GitHub, AWS, Stripe). If sensitive data is detected, the user can withhold it or have it redacted automatically.

---

## Interactive Ask Prompts

When an unlisted domain, `.env` file, or directory write is requested during an interactive terminal session, `auto-permission-system` renders a clean, keyboard-driven prompt:

### 1. Sensitive `.env` Read Prompt
```
🔑  Let pi read your .env file?

    File     ~/workspace/app/.env
    Command  grep -r TOKEN .env
    Risk     the AI will see any keys in it
    Why      .env files usually hold passwords and API keys
    Note     this file holds secrets, so a saved rule is never offered

  > No
    Yes, just this once
    Yes, for this conversation

  Default: No (10s)
```
- **Preselected Default:** `No` is preselected. Pressing Enter immediately blocks the read.
- **Expiry:** If unattended for 10 seconds, the prompt resolves safely to **No** (Block).
- **Trigger shown:** the `Command` line names the part of the command that caused the ask, so a `find` or a `grep` is never guessed at.
- **Name-only listings don't ask:** `find .`, `ls -R` and `tree` print names, not contents. Inside the project that is not a read (the AI can already list its own files); outside the project it still asks and says only the name is exposed (ADR-049).
- **Patterns and templates aren't reads either:** `ls -a | grep -v '\.env'` asks nothing — after `grep`/`rg`/`ag`/`ack` the first free word is a pattern, not a file. `rg`/`fd` never prompt for the dotfiles they skip, and `.env.example` asks only when its content really holds a key (ADR-050).

### 2. Governed Network Egress Prompt
```
🌐  Let bash connect to unknown-telemetry.io?

    Site     unknown-telemetry.io
    Command  curl -s https://unknown-telemetry.io/ping
    Why      this site isn't on your allowed list yet

  > No
    Yes, just this once
    Yes, all in group for this conversation
    Yes, always…

  Default: Yes, just this once (15s)
```
- **Network Expiry Rule:** Domain prompts feature a 15-second countdown defaulting to `Allow once` for smooth browsing. Pressing `↑` or `↓` immediately stops the countdown, returning complete control to Enter/Esc.

### 3. Real-Time Token Leak Redaction Prompt
```
⚠  Sensitive information detected: API Secret Key

    Tool     bash (node verify_service.js)
    Finding  23: sk-(?!ant-)[A-Za-z0-9_-]
    Question Should the AI be allowed to see it?

  > No, keep private  (recommended)
    Yes, allow
```
- `Finding` prints the **complete** detected line and its line number — one `Finding` row per match when several secrets appear, with no truncation.
- Choosing **No, keep private** replaces the token with `***REDACTED***` in the model's context window, preventing credentials from leaking to LLM providers.

---

## Secure Auto Mode & Claude Auto Mode

In modern AI coding tools like Claude Code, developers love **auto mode** because the agent can execute tasks autonomously without constantly prompting for confirmation on trivial, harmless steps.

However, unconstrained auto mode is a significant data breach risk. If an autonomous agent reads credentials, runs unvetted scripts, or sends code to third-party endpoints, the entire developer environment can be compromised.

**Claude Auto Mode for Pi** delivers **Claude-style auto mode with zero-trust security**:
- **Autonomous Execution with Real-Time Guardrails:** The agent operates autonomously within approved boundaries, allowing rapid development while guarding sensitive resources.
- **Advanced Secure Scanning:** Uses `advanced-secure` mode to scan files, commands, and content to stop data breaches before they can occur.
- **Fail-Closed in Headless CI/CD:** When running unattended (`pi -p`, GitHub Actions, Docker, remote devboxes), unapproved operations fail closed immediately with a structured reason instead of hanging or deadlocking the pipeline.

### Activating Claude Auto Mode in CI/CD:

```bash
# 1. Copy the shipped Claude Auto Mode template to your repository:
mkdir -p .pi
cp node_modules/auto-permission-system/sandbox.claude.json .pi/sandbox.json

# 2. Run Pi headlessly with complete automated protection:
pi -p "Review pull request changes, verify dependencies, and execute test suite"
```

#### GitHub Actions Workflow Example:
```yaml
name: CI Security & Agent Review
on: [pull_request]

jobs:
  agent-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install Pi and Auto Permission System
        run: |
          npm install -g @earendil-works/pi-coding-agent
          pi install npm:auto-permission-system
      - name: Activate Claude Auto Mode Preset
        run: |
          mkdir -p .pi
          cp node_modules/auto-permission-system/sandbox.claude.json .pi/sandbox.json
      - name: Run Autonomous Review in Auto Mode
        run: |
          pi -p "Verify changes, run npm test, and flag security issues"
```

---

## Real-Time Secret Detection & Content Scanning

When running in **Advanced Secure Mode** (`advanced-secure`), `auto-permission-system` continuously inspects tool payloads and command stdout/stderr:

- **High-Confidence Credential Recognition:** Recognizes OpenAI API keys, Anthropic keys, AWS credentials (`AKIA...`), GitHub personal access tokens (`ghp_...`, `github_pat_...`), database URIs (`postgres://`, `mongodb://`), and RSA/OpenSSH private keys.
- **Context Protection:** If a build command or tool outputs a secret, the system intercepts the stream and prompts the user or redacts the credential to `***REDACTED***`.
- **Zero-Loss Model Feedback:** The language model is informed that sensitive information was masked, allowing the AI to continue its task without ever seeing or transmitting the actual secret.

---

## Permission System & Modes

`auto-permission-system` provides three selectable permission modes:

| Mode | Inspection Level | Use Case |
|---|---|---|
| **`advanced-secure`** *(Recommended)* | Full rule engine + real-time AST/regex secret detection + MCP risk scoring. | Daily development, autonomous auto mode, untrusted codebases. |
| **`default`** *(Shipped)* | Rule-based filesystem and network sandbox without inspecting payload content. | Standard development where secret detection is not required. |
| **`yolo`** *(Emergency)* | Temporarily disables all sandboxing and tool guards. | Emergency troubleshooting only. |

Switch modes anytime mid-session using `/permission-mode`. Your choice is saved to global settings (`~/.pi/agent/extensions/sandbox.json`) and reflected in the status chip:
- `Sandbox: 🧠 N domains, M paths` for `advanced-secure`
- `Sandbox: 🔒 N domains, M paths` for `default`
- `⚠️ YOLO — all security layers disabled` for `yolo`

---

## Configuration Reference

Policy files are merged hierarchically:

| Priority | Scope | Location | Purpose |
|---|---|---|---|
| 1 (Base) | Package Default | `sandbox.default.json` | Baseline policy shipped with the extension. |
| 2 (Global) | User Global | `~/.pi/agent/extensions/sandbox.json` | Global overrides across all repositories. |
| 3 (Project) | Project Local | `<cwd>/.pi/sandbox.json` | Repository-specific rules (auto-written by prompts). |

### Annotated `sandbox.json`:

```jsonc
{
  "enabled": true,                      // Set false to disable Layer 2
  "mode": "advanced-secure",            // "advanced-secure" (recommended) | "default" | "yolo"
  "network": {
    "allowedDomains": [                 // Allowed domains for bash and fetch_content
      "github.com", "*.github.com",
      "registry.npmjs.org"
    ],
    "deniedDomains": [],                // Hard-denied domains (never asked, always blocked)
    "strictAllowlist": false            // true = fail closed on unknown domains without asking
  },
  "filesystem": {
    "denyRead": [                       // Hard-denied reads (Layer 1 + Layer 2). Key material only
      "~/.ssh", "~/.gnupg", "~/.pi/agent/auth.json"
    ],
    "askRead": [                        // Prompt instead of blocking (one read, never remembered).
      ".env", ".env.*", "~/.aws"      // Without "/" = file name anywhere; with "/" = that folder and everything below it
    ],
    "allowRead": ["~/.aws/config"],    // Escape hatch: an explicit allow wins over an askRead folder
    "modelDenyRead": ["~/.netrc"],      // Hidden from LLM read tool; subprocesses can read
    "allowWrite": [".", "/tmp", "~"],  // Writable roots for bash and edit/write tools (wide: a write is not a leak)
    "denyWrite": ["~/.ssh", "~/.gnupg"], // Key material only, plus *.pem / *.key from the credential tier
    "askWrite": [".env", "~/.bashrc"]  // Critical files: ask before a sudden update changes them
  },
  "subagent": {
    "network": "allow"                  // "allow" | "deny" | "research-only"
  },
  "mcp": {
    "allowTools": [],                   // MCP tool names that never prompt
    "askThreshold": 30                  // Risk score threshold to prompt (lower = stricter)
  },
  "commands": {
    "ask": ["printenv", "env", "/proc/**/environ"] // Bash commands that prompt before running (wrappers traversed)
  }
}
```

### Project Policy Files & Trust (ADR-013)
When cloning a repository with a `.pi/sandbox.json`:
- **Hardening rules** (additional deny paths) apply immediately.
- **Relaxing rules** (allowing `/`, disabling layers, adding external domains) require explicit trust.
- Run `/security trust` to inspect and approve changes, or `/security untrust` to revoke.

---

## Commands & Mid-Session Controls

| Command | Action |
|---|---|
| `/security` | View active Layer 2 policy, project trust status, and the last 10 audit events. |
| `/sandbox` | View active Layer 1 (OS sandbox) status and configuration. |
| `/sandbox reload` | Hot-reload policy rules after manual edits to `sandbox.json`. |
| `/permission-mode` | Switch between **Default**, **Advanced Secure**, and **YOLO** mid-session. |
| `/security trust` | Inspect and trust project-local policy widening in `.pi/sandbox.json`. |
| `/security untrust` | Revoke trust for the current project's policy file. |
| `/tool-view compact` | Claude-style compact rows: consecutive shell commands and file reads become one row; every other tool keeps Pi's block (display only). |
| `/tool-view full` | Back to Pi's own output. Also the shipped default. |
| `/tool-view` | Menu with both choices. |

### Tool view for Pi: Claude-style compact rows (display only)

**Pi tool view** is the presentation half of this package: `/tool-view compact` draws each run of
tool calls the way **Claude Code's tool view** draws them — one collapsed row per run, a mark, a
count and a single timer — while `/tool-view full` leaves Pi's own output exactly as it was. It
touches shell commands, `read` calls and `codemode`; every other tool — `edit`, `write`, `ls`,
`grep`, `find`, MCP tools — keeps Pi's own block, byte for byte:

```text
✓ Running 2 commands · 2s
  └ ✓ $ npm test
  └ ✓ $ git status

✓ Reading 3 files · 1s
  └ ✓ src/config.ts
  └ ✓ src/loader.ts
  └ ✓ src/settings.ts
```

Consecutive shell calls are one row: a header with the count and the elapsed time, then one
`  └ <mark> $ <command>` line per command, in the order they ran. The mark sits in column 1 — `●`
while the group runs, `✓` or `✗` once it settles — and it is the last command's mark, so a failure
earlier in the run keeps its own `└ ✗` line. A single command keeps its own row with a plain
`  └ $ <command>` line.

Consecutive reads are one row too: the same header, then one `  └ <mark> <path>` line per file, in
the order they were read. No `$` prompt, because a read line already names its file; a sliced read
carries its range (`  └ ✓ src/app.ts:120-179`), and a blocked or denied read keeps the word on its
own line (`  └ ✗ ~/.ssh/id_rsa blocked`). A single read keeps one unmarked line (`  └ src/a.ts`).
Eight lines are shown; older calls fold into `  └ ... (2 earlier calls)`. A read and a shell command
never share a row, so `Reading N files` and `Running N commands` stay honest about what ran.

**One timer per row.** The header duration is the only time on screen: it counts up while the run
is live, freezes when it settles, and is the wall-clock time you waited for the whole run — not the
sum of the individual calls. A `└` line carries its mark and its command and nothing else, and the
folded header counts what it hid (`+4`) without timing it.

Once a later call starts, the group above tightens to one line and names its last command:

```text
✓ Running 2 commands (git status) · 2s ctrl+o to expand
```

The name is the last command's last segment, so a `cd … && sed … && echo …` chain collapses to its
final stage. The row is composed against the terminal width: the target takes whatever columns are
left, is cut from the left at a token (or path-segment) boundary, and is dropped when no useful tail
fits — the count, duration and `ctrl+o` hint are never truncated:

```text
100 cols  ✓ Running 4 commands (sed -n 660,700p plan/tool-rows-views.md) · 8s ctrl+o to expand
 80 cols  ✓ Running 4 commands (… 660,700p plan/tool-rows-views.md) · 8s ctrl+o to expand
 60 cols  ✓ Running 4 commands · 8s ctrl+o to expand
```

Newest eight commands; older ones collapse to `  └ ... (2 earlier calls)`. Any other tool call, an
assistant reply that carries text and a new user message all end the group, so two commands are only
ever grouped when they really ran next to each other.

```text
✓ Running 4 commands · 1.2s
  └ ✓ pytest -k "not slow" tests/unit
  └ ✓ ruff check src
  └ ✗ scripts/seed.py --force
  └ … $ python3 -m uvicorn app.main:app
```

A `└` line keeps the command, minus noise: a leading `cd <cwd> &&` is dropped, so are wrappers
(`sudo`, `uv run`, `env A=1`), and `python -m <module>` becomes the module (`pytest`, `ruff`,
`pip`). A pipeline or a chain is **not** reduced to its last stage — `head -40 src/a.ts | head`
still reads as that. The command may take up to 70 % of the width; past that the middle collapses
(`program arg … last-path`), then the arguments go (`program … tail`), and only the program is left
when nothing else fits. `blocked` / `denied` ride with the command, left of it, and the line ends
where its text ends. Only the folded header names the last segment.

A `codemode` call gets its own row too: a fixed `codemode` title with its timer, the script's first
statement, and one line per inner call with that call's mark:

```text
✓ codemode · 3s
  └ await tools.searchTools("rank")
  └ ✓ mcp:dev-radius:search rank
  └ ✓ read src/config.ts
```

Inner calls are live (`…` while running, then `✓` or `✗`) and never become rows of their own, so a
`codemode` run stays one row however many tools it calls.

A blocked or denied command is never silent: a single command says so on its row
(`✗ Running 1 command denied`), and inside a group the word rides on the command line
(`  └ ✗ $ cat id_rsa blocked`).

A streaming thought rides on the live row in brackets and stays Pi's own block otherwise:

```text
● Running 2 commands (thinking 4s) · 26s
  └ ✓ $ npm test
  └ … $ npm run build
```

The bracket borrows the target slot, ticks once a second, never counts as a call, and is dropped the
moment the thought completes. The row's own timer keeps counting while the thought streams — it
freezes only when the row settles — so a live row never looks stopped. In `compact` a hidden thought
takes no space at all: Pi's hidden-thinking label is blanked for the session, so no `Thinking...`
line and no gap appear between commands, and the run keeps one header. Open the row to Pi's view and
that call's thought comes back as a collapsed `Thinking...` line above its output; a further click
opens the text. `full` restores the label, so thinking reads exactly as Pi renders it. Text,
`write`, another tool kind or a user message still ends the group.

Expanding is Pi's too — `compact` never redraws Pi's block. Click a folded row and it unfolds to its
`└` lines first — for a read run those lines are its files — click again and Pi draws its own block
for every call in the group — same frame, same padding, same background, same preview line as
`full` — then click again for the full output, and once more to fold it back. A group that is
already the newest row shows its `└` lines, so its first click goes straight to Pi's block; a read
run never jumps from one folded line to three file bodies. The compact row is only the collapsed
level of that same view.

- The choice is stored in `~/.pi/agent/tool-view.json` (`{"view": "compact"}`), so the next session
  agrees. Missing or unparsable file → `full`.
- Default: `full`. Nothing changes until you switch it on.
- Display only: the row renderer never reads or writes the policy, and every security decision —
  sandbox, guard, ask prompt, audit log — is identical in both views. The tool view is not a
  permission setting and never changes what runs.

---

## Escape Hatches

For emergencies or troubleshooting, disable security temporarily:

```bash
# Disable all security layers for a single invocation
pi --yolo

# Alias for --yolo
pi --no-sandbox
```

Mid-session, type `/permission-mode` and pick **YOLO** to disable layers in place without restarting.

---

## Audit Logging

Every decision (allow, block, ask, redaction) is appended as a structured JSON Line to `~/.pi/agent/audit.log`:

```json
{
  "ts": "2026-10-13T19:22:15.000Z",
  "layer": 1,
  "tool": "bash",
  "subject": "/etc/crontab",
  "reason": "denyWrite matched /etc/crontab",
  "decision": "no",
  "cwd": "/home/user/workspace/app"
}
```

### Querying the Audit Log:
```bash
# View recent blocked actions
grep '"decision":"no"' ~/.pi/agent/audit.log | tail -n 10

# View secret redaction events
grep '"finding"' ~/.pi/agent/audit.log | tail -n 10
```

---

## FAQ & Scenarios

A selection of common questions is below.

### How does Claude Auto Mode secure unattended runs?
In headless mode (`pi -p` or subagent executions), interactive ask prompts cannot be presented to a human. Auto Permission System operates in a fail-closed posture: any tool call or bash command targeting an unlisted domain, credential file, or outside-project path is automatically blocked, and the refusal reason is provided to the agent and recorded in the audit log.

### What is the relationship between Claude Auto Mode and Claude's auto mode?
Claude Code popularized autonomous "auto mode", allowing developers to let AI code without stopping for confirmation on harmless steps. Claude Auto Mode brings this exact convenience to the Pi coding agent, but adds essential zero-trust boundaries: using Advanced Secure Mode to scan files, shell commands, and content to guarantee that autonomous execution never leads to data breaches or leaked API tokens.

### How do I allow the agent to reach a new domain?
Add it to `network.allowedDomains` in `<cwd>/.pi/sandbox.json` or `~/.pi/agent/extensions/sandbox.json`, or run a curl command once and select **Yes, always… → All in group in this project**.

### Why was my tool call or command blocked?
Run `/security` to inspect active policy rules and the last 10 audit events. Check `~/.pi/agent/audit.log` to view the exact matching rule (`reason`).

### Where is the Claude tool view for Pi?
Pi ships its own tool blocks. This package adds the **Claude Code style tool view** on top of them: run `/tool-view compact` (or pick it from `/tool-view`) and each run of shell commands, `read` calls and `codemode` collapses into one row — a mark, a count, one timer, and a `└` line per command or file — instead of a full block per call. `/tool-view full` puts Pi's own output back, and the choice is remembered in `~/.pi/agent/tool-view.json`.

### Is the tool view a permission or security setting?
No. The tool view is a renderer: it never reads or writes `sandbox.json`, and every allow/deny decision, ask prompt and audit entry is the same in `compact` and `full`. Switching views cannot make a blocked call run, and a blocked or denied call keeps its `✗` mark and the word `blocked` / `denied` on its row.

### What is “auto secure” mode?
“Auto secure” is the `advanced-secure` permission mode (`/permission-mode` → **Advanced Secure**). It keeps every rule from the policy file and adds secret and credential detection, risk scoring for MCP tools, and real-time redaction of anything that looks like a token before the model sees it. It can only add asks or blocks; it never loosens a rule.

### Does it protect PyPI credentials and `pip install` runs?
Yes. `pypi-…` upload tokens are matched, hidden and redacted like any other credential, `~/.pypirc` asks before a read or a write in the shipped policy, and `pypi.org` / `*.pypi.org` are governed hosts, so a `pip install` cannot quietly ship your package index token to another endpoint. The same rules cover OpenAI, Anthropic, GitHub, AWS and Stripe credentials.

### How is this different from Claude Code's permission system?
Claude Code's permission system belongs to Claude Code. This package implements the same ideas for the **Pi** coding agent as an extension: two enforced layers (OS sandbox + in-process tool guard), the same ask-tier prompts, project policy files with a trust step, a JSONL audit log, and a Claude-style compact tool view — all configurable through `sandbox.json`. It does not run, wrap or require Claude Code.

### Does it work on Windows?
Layer 2 (In-Process Tool Guard) and Layer 3 (Output Redactor) are platform-independent. Layer 1 (OS Sandbox) requires `sandbox-exec` (macOS, built-in) or `bubblewrap` + `socat` (Linux).

---

## Glossary & entities

One spelling per thing, so a person and a model mean the same thing when they talk about this package.

### Entities

| Entity | What it is | Canonical name / aliases |
|---|---|---|
| **Auto Permission System** | This package | npm `auto-permission-system`, GitHub `Navin009/auto-permission-system` |
| **Pi** | The coding agent this package extends | Pi coding agent, `@earendil-works/pi-coding-agent`, [pi.dev](https://pi.dev) |
| **Pi permission system** | The two enforced layers plus the redactor in this package | “security for Pi”, “permissions for Pi”, “permission system for Pi” |
| **Claude auto mode for Pi** | The autonomous, fail-closed posture and its `sandbox.claude.json` preset | “Claude auto mode”, “safe auto mode”, “Claude-style auto mode” |
| **Auto Secure** | The `advanced-secure` permission mode | “auto secure”, “secure it”, `advanced-secure` |
| **Pi tool view** | The compact tool-call renderer | “Claude tool view for Pi”, “Claude-style tool view”, `/tool-view` |
| **Claude Code** | The AI coding tool whose auto mode and compact tool rows inspired these two features | Anthropic's CLI agent — inspiration, not a dependency |
| **Navin Kumar** | Author and maintainer | GitHub [@Navin009](https://github.com/Navin009) |

### Terms

| Term | Definition |
|---|---|
| **Layer 1** | The OS-level sandbox around `bash`: `bubblewrap` on Linux, `sandbox-exec` on macOS. Enforces write roots, deny-read paths and network egress from outside the agent process, so a block holds even when the model was not asked. |
| **Layer 2** | The in-process tool guard: a `tool_call` hook that applies the same policy file to `read`, `grep`, `find`, `ls`, `write`, `edit`, `fetch_content`, `web_search` and MCP tools, and a `tool_result` hook that filters denied files out of search output. |
| **Layer 3 / Auto Secure** | The content redactor: scans tool output for credential patterns and asks or redacts before the text reaches the model's context. |
| **Permission mode** | `default` (rules only), `advanced-secure` (rules + secret detection + MCP risk scoring) or `YOLO` (every layer off). Chosen with `/permission-mode`, saved to the global `sandbox.json`. |
| **`sandbox.json`** | The plain-JSON policy file. Merged from four places: the shipped default, the shipped Claude preset, the global file and the project file. |
| **Ask tier** | A rule that prompts instead of blocking: read, write, domain or MCP call. Answers can last one call, one conversation, this project or all projects. |
| **Absolute-deny tier** | Paths that are always blocked and need two confirmations to allow, even interactively: `~/.ssh`, `~/.gnupg`, `~/.aws`, `*.pem`, `*.key`, `~/.pi/agent/auth.json`. |
| **Project trust** | A project's `.pi/sandbox.json` may only **tighten** the policy until you run `/security trust`; the trust store records the exact file content. |
| **MCP gate** | The Advanced Secure check that risk-scores `mcp__<server>__<tool>` calls by name and arguments and asks before destructive ones run. |
| **Row** | One line in the compact tool view: a mark, a count and one timer, standing for a run of calls. A `└` line under it is one command, one file or one inner `codemode` call. |
| **Audit log** | `~/.pi/agent/audit.log`, append-only JSONL, one entry per allow, block, ask or redaction decision. |

---

## Trust & provenance

Why the claims on this page can be checked instead of taken on faith.

- **Author and maintenance.** Written and maintained by [Navin Kumar](https://github.com/Navin009). Every change lands on `main` as a Conventional Commit — `commitlint` rejects the rest — and the reasoning for a non-trivial decision is recorded in the commit body, so the design history is public and searchable.
- **A dashboard that cannot drift.** [`SECURITY.md`](./SECURITY.md) is generated from [`security/manifest.json`](./security/manifest.json) by `security/render.mjs`: layer status, the source files that implement each layer, and the names of the tests that cover them. It is regenerated by `./security/check.sh`, so it reports the code as it is, not as it was described once.
- **Tests you can run yourself.** `npm run typecheck` checks the TypeScript entry points against Pi's own bundled types; `npm test` runs the unit and contract suites (51 files) covering path matching, URL allowlists, symlink escapes, ask flows, project trust and the tool view; an opt-in Layer 1 end-to-end test (`APS_E2E=1`) exercises real `bubblewrap`. All of it runs on every push to `main` before a release can be cut.
- **Every decision is recorded.** Each allow, deny, ask and redaction is appended to `~/.pi/agent/audit.log` as JSONL with the layer, the subject and the reason, so a user can prove what happened in a run rather than trusting a summary.
- **No hidden authority.** The policy is a plain JSON file you can read and edit; the package has one runtime dependency ([`@anthropic-ai/sandbox-runtime`](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime)) and downloads no binary at runtime. There is no account, no API key, no hosted service and no telemetry added by this package.
- **Released in public.** Every release is tagged on GitHub and written to [`CHANGELOG.md`](./CHANGELOG.md) by semantic-release from the commit history; npm publishing is opt-in and gated as described in [`PUBLISHING.md`](./PUBLISHING.md).
- **Stated limits.** Detection is AST plus pattern matching, not a proof of safety — a secret built at runtime, or a file no rule names, can still be read. Layer 1 needs `bubblewrap` + `socat` on Linux and `sandbox-exec` on macOS, and is not available on Windows; on Windows only Layers 2 and 3 apply. This page is written to be precise about that rather than to sound complete.

Docs reviewed: **2026-11-13**.

---

## For AI assistants & answer engines

This page is written to be quotable, and the machine-readable files next to it say the same things in structured form:

| File | What it is for |
|---|---|
| [`llms.txt`](./llms.txt) | A short, link-rich summary in the emerging `llms.txt` convention, so a crawler or assistant can load the facts and the entry points in one request. |
| [`assets/schema.jsonld`](./assets/schema.jsonld) | Schema.org JSON-LD: `SoftwareApplication` (with aliases, keywords, license, feature list), the `Person` who maintains it, and a `FAQPage` of the questions above. Embed it in a landing page `<script type="application/ld+json">` or submit it as-is where a registry accepts schema. |
| [`skills/auto-permission-system/SKILL.md`](./skills/auto-permission-system/SKILL.md) | The policy reference Pi itself loads when you ask about this package — the same facts, written for a model that has to answer a user. |

### Canonical facts

- Package: `auto-permission-system` — Pi extension, TypeScript, MIT, zero runtime cost.
- Install: `pi install npm:auto-permission-system` (or `pi -e npm:auto-permission-system` for one session).
- Entry points: `extensions/sandbox.ts` (Layer 1), `extensions/guard.ts` (Layer 2), `extensions/permission-mode.ts`, `extensions/tool-view.ts` (display only).
- Commands: `/security`, `/sandbox`, `/permission-mode`, `/tool-view`.
- Storage: `<cwd>/.pi/sandbox.json`, `~/.pi/agent/extensions/sandbox.json`, `~/.pi/agent/tool-view.json`, `~/.pi/agent/audit.log`.
- Platforms: Linux (`bubblewrap`, `socat`), macOS (`sandbox-exec`); Layers 2–3 on Windows.

### Citing this project

> Auto Permission System is an MIT-licensed extension for the Pi coding agent that adds a zero-trust
> permission system — an OS sandbox for `bash`, an in-process tool guard, and secret redaction —
> plus a Claude-style compact tool view, installed with `pi install npm:auto-permission-system`.

When naming the renderer, say **“the Pi tool view”** or **“the compact tool view in auto-permission-system”**: the compact rows are this package's rendering for Pi, not a Claude Code feature.

---

## Development & Testing

### Running Tests:
```bash
# Clone repository
git clone https://github.com/Navin009/auto-permission-system
cd auto-permission-system

# Install development dependencies
npm install

# Typecheck TypeScript against Pi's bundled types
npm run typecheck

# Run unit and contract test suites (51 test suites)
npm test

# Run manual Layer 1 sandbox end-to-end test (requires bubblewrap)
APS_E2E=1 node --import ./security/tests/ts-loader.mjs security/tests/e2e/sandbox-fs.mjs
```

### Running the Demo Suite:
```bash
# Run interactive terminal simulation
./demo/run-demo.sh

# Regenerate MP4 and GIF recording assets
python3 demo/generate-recording.py
```

---

## Releasing

Releases are fully automated with [semantic-release](https://semantic-release.gitbook.io/), driven by [Conventional Commits](https://www.conventionalcommits.org/) on `main`:
- `fix: ...` → Patch release
- `feat: ...` → Minor release
- `feat!: ...` or `BREAKING CHANGE:` → Major release

Pull requests are verified via `commitlint`. Publishing to npm is triggered automatically when `NPM_PUBLISH` is `true`. See **[PUBLISHING.md](PUBLISHING.md)** for details.

---

## License

MIT © [Navin Kumar](https://github.com/Navin009)
