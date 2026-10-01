# Changelog

All notable changes to this project will be documented in this file.
Entries below [1.0.0] are generated automatically by [semantic-release](https://semantic-release.gitbook.io/) from [Conventional Commits](https://www.conventionalcommits.org/) — do not edit by hand.

# [1.2.0](https://github.com/hannesro/pi-secure-it/compare/v1.1.0...v1.2.0) (2026-10-01)


### Bug Fixes

* **deps:** bump @anthropic-ai/sandbox-runtime to ^0.0.78 ([de536c8](https://github.com/hannesro/pi-secure-it/commit/de536c83962d6203700696ae27543d0b9d5dc512))
* **guard:** enforce the read policy on grep, find and ls ([3b8d992](https://github.com/hannesro/pi-secure-it/commit/3b8d992ebbcd02d87bbe99f7f190fbe8a019d6cf))
* **guard:** make the absolute-deny tier deny on its own ([bad9249](https://github.com/hannesro/pi-secure-it/commit/bad9249aa5374bc9dde5989bd189a12c5405e9af)), closes [hi#risk](https://github.com/hi/issues/risk)


### Features

* **guard:** two-step select instead of typing "i understand" ([a4b1430](https://github.com/hannesro/pi-secure-it/commit/a4b14304398d5197e7b6d5fa025b9e5726769c0e))

# [1.1.0](https://github.com/hannesro/pi-secure-it/compare/v1.0.0...v1.1.0) (2026-07-19)


### Features

* add CLAUDE.md for documentation on pi-secure-it extension and conventions ([b5e6487](https://github.com/hannesro/pi-secure-it/commit/b5e6487c7334be0bc42a7af7dff96a6aaa3a5dcf))

# 1.0.0 (2026-07-19)


### Features

* Implement CI/CD workflows with semantic-release, updated dependencies ([f53b39a](https://github.com/hannesro/pi-secure-it/commit/f53b39a8be162d22a1cddca123ae3c00b7dca70a))
* Update CI configuration and add test script to package.json ([bc43b09](https://github.com/hannesro/pi-secure-it/commit/bc43b09f69a4ef849d39c045c3dd609d316e7728))

## [1.0.0] - 2026-07-15

### Added
- **Layer 1** — OS-level bash sandbox via `@anthropic-ai/sandbox-runtime` (`sandbox-exec` on macOS, `bubblewrap` on Linux). Blocks filesystem writes outside `allowWrite`, reads of `denyRead`, and network outside `allowedDomains`.
- **Layer 2** — In-process tool guard hooking `read`, `write`, `edit`, `fetch_content`, `web_search`, `get_search_content`. Applies the same policy file as Layer 1.
- **Layer 3** — Subagent posture: stricter network policy when `ctx.hasUI === false` (subagents, `-p` mode, JSON mode). Configurable via `subagent.network`: `allow` (default) | `deny` | `research-only`.
- **Ask-tier prompts** — Interactive per-call allow/deny dialog with four persistence tiers: this-once, always-for-current-project (file), always-for-current-project (folder), always-for-all-projects (file), always-for-all-projects (folder). Persists to `.pi/sandbox.json` or `~/.pi/agent/extensions/sandbox.json`.
- **Absolute-deny tier** — Credential material (`~/.ssh`, `~/.gnupg`, `~/.aws`, `*.pem`, `*.key`) requires typing `"i understand"` verbatim; "always" is never available for this tier.
- **`/security` command** — Shows active policy, project-local overrides, and last 10 audit events.
- **`/sandbox` command** — Shows current bash sandbox config. `/sandbox reload` live-reloads after manual edits to `sandbox.json`.
- **Audit log** — Append-only JSONL at `~/.pi/agent/audit.log`. One entry per blocked/allowed/always decision.
- **`sandbox.example.json`** — Documented reference config showing all available fields.
- **Skill** — `skills/pi-secure-it/SKILL.md` explains the security model and how to configure it.
