# auto-permission-system

Two-layer security extension for the [Pi coding agent](https://pi.dev):

- **Layer 1** — OS-level bash sandbox (`sandbox-exec` on macOS, `bubblewrap` on Linux) that blocks filesystem writes outside an allow-list, reads of sensitive paths, reads outside the project when `outsideProject.read` gates them, and network egress to unlisted domains.
- **Layer 2** — In-process tool guard applying the same policy to the tools the OS sandbox can't reach: `read`, `grep`, `find`, `ls`, `write`, `edit`, `fetch_content`, `web_search`, `get_search_content`. `grep` output lines from denied files beneath an allowed search root are removed before the model sees them.
- **Layer 3** — Subagent posture: optionally drop or restrict network access when running headless (`-p`, JSON mode, subagents).

When a tool call is blocked you get an interactive prompt — no need to leave pi and hand-edit config files. Choose *this once*, *always for this project*, or *always for all projects* (file or parent-folder granularity). Decisions are persisted and audited.

## Install

```bash
# From npm (once published)
pi install npm:auto-permission-system

# From git
pi install git:github.com/Navin009/auto-permission-system

# Try without installing
pi -e git:github.com/Navin009/auto-permission-system
```

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
    "allowedDomains": [                 // domains fetch_content / get_search_content may reach
      "github.com", "*.github.com",
      "registry.npmjs.org"
    ],
    "deniedDomains": []                 // explicit block-list (checked before allowedDomains)
  },
  "filesystem": {
    "denyRead": ["~/.ssh", "~/.aws", "~/.pi/agent"],  // Layer 1 + Layer 2: no read at all
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

`no — block` is pre-selected, so Enter alone blocks. Besides `yes — this once` and the persistent `always` options there is `yes — for this session` (this file, its folder, or this domain), kept in memory until the session ends and never saved (ADR-010).

Every prompt waits **10 seconds** by default. If you do not answer, it resolves to the safe default: **block / deny**.

### File-name patterns

An entry without `/` or `~` (`.env`, `*.key`) is a file name. pi's own tools (Layer 2) match it anywhere on disk; bash (Layer 1) matches it anywhere under the project directory, so `packages/api/.env` is covered too. Use a full path (`~/other/.env`) to cover a file outside the project for bash.

### Permission modes

`mode` selects how much pi inspects, on top of the rules:

- **`default`** (shipped) — rules only: sandbox.json paths, domains, and commands. Nothing inspects file contents.
- **`advanced-secure`** — adds secret/credential detection:
  - **File reads:** a filename that looks like a credential store asks before the read.
  - **MCP calls:** `mcp__<server>__<tool>` calls are classified; a risky (mutating/destructive) call asks before it runs.
  - **Tool/command/file output:** before any output reaches the model, a secret-like hit shows `⚠ Private content found`, the file, and each detected line as `lineNo: text`, and the question **Should the AI be allowed to see it?** with two choices — **No, keep private** or **Yes, allow**. A bare `key=<random>` counts; `key=value` does not. No, keep private withholds the output and tells the model plainly that the output was withheld because it may contain sensitive information, so the model does not mistake it for a failure or an empty result. Esc or timeout keeps it private.

Detection can only **add** asks or blocks; it never loosens a rule. The mode is layered like every other key: an untrusted project may opt *in* to `advanced-secure`, but only a trusted project (or the global file) may turn it off.

Change it with `/permission-mode` or the **Shift+S** shortcut; the choice is saved to the global `sandbox.json` and shown in the footer (`🛡 Default (Shift+S)` / `🛡 Advanced Secure (Shift+S)`).

### Commands that print secrets

Bash commands that dump the environment can print the API tokens pi runs on. `commands.ask` lists them, and Layer 1 asks before running one (`Block` / `Allow once`); deny runs nothing (ADR-017). An entry without `/` is a command name (matched on the head of each `;`/`&&`/`|` segment); an entry with a path is globbed against every path token, so any reader of the per-process environ file is caught. The shipped default is `["printenv", "env", "/proc/*/environ"]`.

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
| `/permission-mode` (or **Shift+S**) | Choose the permission mode: Default (rules) or Advanced Secure (secret detection) |

## Escape hatches

```bash
pi --yolo          # disables ALL layers globally (visible warning banner)
pi --no-sandbox    # alias for --yolo
```

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
3. Publishes to npm (`npm publish --provenance`) and bumps `package.json`.
4. Creates the `vX.Y.Z` git tag and GitHub release.
5. Commits `CHANGELOG.md`/`package.json` back to `main` (`chore(release): ... [skip ci]`).

Nothing to run locally beyond writing conventional commit messages — just merge to `main`. Publishing uses npm [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) — no `NPM_TOKEN` secret required. One-time setup on npmjs.com:

1. Go to the package's **Settings → Trusted Publisher** on npmjs.com.
2. Select **GitHub Actions** and configure: organization/user `Navin009`, repository `auto-permission-system`, workflow filename `release.yml`, allowed action `npm publish`.
3. (Recommended) Under **Settings → Publishing access**, choose "Require two-factor authentication and disallow tokens" to disable classic token-based publishing entirely, and revoke any automation tokens you previously created.

`GITHUB_TOKEN` is provided automatically by Actions; the `id-token: write` permission in `release.yml` is what lets npm's OIDC exchange work.

## License

MIT
