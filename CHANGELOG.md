# Changelog

All notable changes to this project will be documented in this file.
Entries below [1.0.0] are generated automatically by [semantic-release](https://semantic-release.gitbook.io/) from [Conventional Commits](https://www.conventionalcommits.org/) — do not edit by hand.

# [2.0.0](https://github.com/Navin009/auto-permission-system/compare/v1.2.0...v2.0.0) (2026-10-02)


* fix(policy)!: an untrusted project sandbox.json may only tighten the policy ([94deb76](https://github.com/Navin009/auto-permission-system/commit/94deb763cbaf47c908a7a746cc59a469979f92d9))


### Bug Fixes

* **policy:** explain an untrusted project file in plain words and remember "no" ([0a38470](https://github.com/Navin009/auto-permission-system/commit/0a38470788df9b6eb91a334b48c61cee4f726e9c))
* **sandbox:** attribute Layer 1 blocks to the right path and never offer / as a grant ([c8c89be](https://github.com/Navin009/auto-permission-system/commit/c8c89bec61a3b7077c71173e36bae343a345ddcd))
* **sandbox:** make file-name deny patterns match anywhere in the project for bash ([fdd8f22](https://github.com/Navin009/auto-permission-system/commit/fdd8f22fe97f2a3c6c7615b798bea578bbc25f05))


### Features

* **guard:** ask before reading outside the project; a named path runs once ([49e089a](https://github.com/Navin009/auto-permission-system/commit/49e089affa8bf98d9f02163f4b8c9d56e9882516))
* **guard:** pre-select "no" in the ask-tier prompt and add session grants ([b1e5530](https://github.com/Navin009/auto-permission-system/commit/b1e553030e133f2749ad6214bcf7ac13f6f0695d))


### BREAKING CHANGES

* existing project .pi/sandbox.json files are untrusted
after upgrading. Their deny rules still apply; their allow lists,
overrides and enabled flag apply after one /security trust per project.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

# [1.2.0](https://github.com/Navin009/auto-permission-system/compare/v1.1.0...v1.2.0) (2026-10-01)


### Bug Fixes

* **deps:** bump @anthropic-ai/sandbox-runtime to ^0.0.78 ([de536c8](https://github.com/Navin009/auto-permission-system/commit/de536c83962d6203700696ae27543d0b9d5dc512))
* **guard:** enforce the read policy on grep, find and ls ([3b8d992](https://github.com/Navin009/auto-permission-system/commit/3b8d992ebbcd02d87bbe99f7f190fbe8a019d6cf))
* **guard:** make the absolute-deny tier deny on its own ([bad9249](https://github.com/Navin009/auto-permission-system/commit/bad9249aa5374bc9dde5989bd189a12c5405e9af)), closes [hi#risk](https://github.com/hi/issues/risk)


### Features

* **guard:** two-step select instead of typing "i understand" ([a4b1430](https://github.com/Navin009/auto-permission-system/commit/a4b14304398d5197e7b6d5fa025b9e5726769c0e))

# [1.1.0](https://github.com/Navin009/auto-permission-system/compare/v1.0.0...v1.1.0) (2026-07-19)


### Features

* add CLAUDE.md for documentation on pi-secure-it extension and conventions ([b5e6487](https://github.com/Navin009/auto-permission-system/commit/b5e6487c7334be0bc42a7af7dff96a6aaa3a5dcf))

# 1.0.0 (2026-07-19)


### Features

* Implement CI/CD workflows with semantic-release, updated dependencies ([f53b39a](https://github.com/Navin009/auto-permission-system/commit/f53b39a8be162d22a1cddca123ae3c00b7dca70a))
* Update CI configuration and add test script to package.json ([bc43b09](https://github.com/Navin009/auto-permission-system/commit/bc43b09f69a4ef849d39c045c3dd609d316e7728))

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
