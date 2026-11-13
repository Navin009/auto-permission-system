# Changelog

All notable changes to this project will be documented in this file.
Entries below [1.0.0] are generated automatically by [semantic-release](https://semantic-release.gitbook.io/) from [Conventional Commits](https://www.conventionalcommits.org/) — do not edit by hand.

## [6.0.2](https://github.com/Navin009/auto-permission-system/compare/v6.0.1...v6.0.2) (2026-11-13)


### Bug Fixes

* **tool-view:** give codemode a row target so its compact row draws ([bc12b12](https://github.com/Navin009/auto-permission-system/commit/bc12b124fdc9c0e9b8af1b2da62004f3cb270632))

## [6.0.1](https://github.com/Navin009/auto-permission-system/compare/v6.0.0...v6.0.1) (2026-11-13)


### Bug Fixes

* **ci:** run the suite on Linux without the sandbox runtime ([8c819b1](https://github.com/Navin009/auto-permission-system/commit/8c819b1b09c5b1ff9562e27f9a8114c7ad1741a0))
* **security:** protect session transcripts and inline program writes ([a7f94fc](https://github.com/Navin009/auto-permission-system/commit/a7f94fc10843d213882c343e016cafeab2236b2a))
* **security:** split command segments only outside quotes ([52f9706](https://github.com/Navin009/auto-permission-system/commit/52f9706f6cb074b33f86ef56cffd078bd290006a))

# [6.0.0](https://github.com/Navin009/auto-permission-system/compare/v5.2.0...v6.0.0) (2026-11-13)


* **security:** keep the default policy only in sandbox.default.json ([f71a9a6](https://github.com/Navin009/auto-permission-system/commit/f71a9a6d0ff204796ac742ba1055e314621dece8))


### Bug Fixes

* **tool-view:** keep one timer on the row and drop every inner one ([d55676c](https://github.com/Navin009/auto-permission-system/commit/d55676c2c834c8fda33f439e644c492c835b449b))
* **tool-view:** restore the spacer under the thought and drop the block padding when one is shown ([c3b2675](https://github.com/Navin009/auto-permission-system/commit/c3b26750720590905960b4ec6ffee6c94e5f2501))
* **tool-view:** drop the extra spacer between the thinking row and the block ([b30f28f](https://github.com/Navin009/auto-permission-system/commit/b30f28fee7c775ccc3e5f10055d286d45bd91c04))
* **tool-view:** give the thinking row a plain blank line above and below ([9a6f9f8](https://github.com/Navin009/auto-permission-system/commit/9a6f9f81962cfd73e8bdaf5c4989f9ff4ccae3b3))
* **tool-view:** keep the expanded thinking on its own row above the block ([ba60cfd](https://github.com/Navin009/auto-permission-system/commit/ba60cfd128aa23792b2a5b88c9d08eef969d210f))
* **tool-view:** show an inline script's first line instead of python3 (stdin) ([20a2cdf](https://github.com/Navin009/auto-permission-system/commit/20a2cdf683a63d7258f052c2a41c4addd73ad17a))
* **tool-view:** keep a run's lines contiguous and start the expanded thought collapsed ([4c0dc58](https://github.com/Navin009/auto-permission-system/commit/4c0dc583554c86442c1020c71252392adc90574f))
* **security:** stop asking for a read a command never makes ([16316bb](https://github.com/Navin009/auto-permission-system/commit/16316bbd265375a2e786cde99bf9ac0c39020632))
* **tool-view:** blank Pi's hidden-thinking label in compact so thoughts take no space ([5f44ebc](https://github.com/Navin009/auto-permission-system/commit/5f44ebcdf62a4c51bcbee17a6ae42f0b531fcf36))
* **tool-view:** draw each row member in its own slot so thoughts never split a run ([1f616e5](https://github.com/Navin009/auto-permission-system/commit/1f616e573b7c171b55d419bc6c96011b09ba8906))
* **tool-view:** keep command runs together across native thoughts ([9710129](https://github.com/Navin009/auto-permission-system/commit/97101298f632a72a014f62203b73ef821f5a61ed))
* **tool-view:** keep command runs together across native thoughts ([963134e](https://github.com/Navin009/auto-permission-system/commit/963134ece5a2e104b3d768dfc2dd3628185fe14d))
* **tool-view:** leave Pi's thinking block alone and end the row at it ([549d55b](https://github.com/Navin009/auto-permission-system/commit/549d55b82d208565644e2fc6255dc989f7c6ce9c))
* **tool-view:** draw the live thought line in Pi's own thinking style ([5a815d9](https://github.com/Navin009/auto-permission-system/commit/5a815d989e7602732e5199f9a29bd6e85b28d065))
* **tool-view:** hide a thought outright instead of moving the row past it ([399bc61](https://github.com/Navin009/auto-permission-system/commit/399bc61a2f12b01841b136c002b6e224a7fb6633))
* **tool-view:** repaint the mount a joining command takes over from ([6ae7227](https://github.com/Navin009/auto-permission-system/commit/6ae722769456f6fc66643b2de45e57cdf06ad2d5))
* **tool-view:** draw a row from its newest command so it sits below a thought ([c7d6898](https://github.com/Navin009/auto-permission-system/commit/c7d6898a5591775790eed8f156781ee9c63fb08a))
* **tool-view:** end a row at a thought instead of growing above it ([e61a18e](https://github.com/Navin009/auto-permission-system/commit/e61a18e6a6133727b748a216147c8c6ed3b3ba65))
* **tool-view:** keep thinking natively in place and end rows at their text ([fc170fc](https://github.com/Navin009/auto-permission-system/commit/fc170fcdff98a08a629b9c1b9edb4ae67a05e0fd))
* **sandbox:** show the whole command in the ask-read prompt ([65841ef](https://github.com/Navin009/auto-permission-system/commit/65841ef721e1dbeec3b9a206b6c3839b36fb6a74))
* **tool-view:** survive a resume, show one Thinking... at the point, and put every duration on the right edge ([6def983](https://github.com/Navin009/auto-permission-system/commit/6def983e7f02566b61b1b018910563d5113ee634))
* **tool-view:** keep commands whole in a group and hide Thinking... while a row is live ([eb029f0](https://github.com/Navin009/auto-permission-system/commit/eb029f0318f4a885098041bbc9cd31e418dc5dc2))
* **tool-view:** keep a command group open across tool-only turns ([c9546a1](https://github.com/Navin009/auto-permission-system/commit/c9546a12318b4136c5d7ed48b5e692fec616abb9))
* **tool-view:** draw an expanded command as Pi's own framed block ([922bca4](https://github.com/Navin009/auto-permission-system/commit/922bca487a954b52ca799d9a12c16d0ee0006b5e))


### Features

* **tool-view:** name the programs a folded run ran, and space the thought inside its block ([dcf3e82](https://github.com/Navin009/auto-permission-system/commit/dcf3e820b194de881cdbef2d0ce91b2e6a3c9c61))
* **tool-view:** give codemode its own compact row with one line per inner call ([af2794f](https://github.com/Navin009/auto-permission-system/commit/af2794f5abe4f1c8742b0783b85ac6bbadfb3a4e))
* **tool-view:** show a call's own thinking when the row is opened to Pi's view ([e240575](https://github.com/Navin009/auto-permission-system/commit/e240575c8578f106090f3853091789cad983f76b))
* **tool-view:** give the live thought line its own click and its own lifetime ([5eb698e](https://github.com/Navin009/auto-permission-system/commit/5eb698e659d5efa13150dd7a4f3bd0ac09d47aa4))
* **tool-view:** list a read run's files as child lines ([357d929](https://github.com/Navin009/auto-permission-system/commit/357d9298b85bebbc16f4174a559530e8c5271655))
* **tool-view:** draw a streaming thought as a line inside the row ([8e2d824](https://github.com/Navin009/auto-permission-system/commit/8e2d824ae08f73beb7b2ebfc1e8a1d7aa399d49a))
* **tool-view:** readable command lines, a group-view step, and Pi's own Thinking... back ([e135fd8](https://github.com/Navin009/auto-permission-system/commit/e135fd844b233eeaa46afc90c0ecbf78ea9e8e6c))
* **tool-view:** a picker like /permission-mode, a live row timer, a budgeted folded target ([c049f1b](https://github.com/Navin009/auto-permission-system/commit/c049f1b08f07e3d49655972fe78a5529c414d7a2))
* **tool-view:** row reads, Pi's own frame on expand, one thinking trace ([23e0c5e](https://github.com/Navin009/auto-permission-system/commit/23e0c5ef44490ff820a4471df5b119eaab710eec))
* **tool-view:** draw only the collapsed row and hand Pi's block back on expand ([e69095f](https://github.com/Navin009/auto-permission-system/commit/e69095f27de8e7525dc45f7f9424c9b5c9dca467))
* **tool-view:** a running thought rides in the row header as (thinking… Ns) ([f3d5d2b](https://github.com/Navin009/auto-permission-system/commit/f3d5d2b759dbbe5d9accf6e5dceef1e5b469f361))
* **tool-view:** open a row in two steps, Pi's collapsed block then the full one ([8eab14e](https://github.com/Navin009/auto-permission-system/commit/8eab14ebc755fd0d2edc2f3789ba323293c93126))
* **tool-view:** group consecutive shell commands, leave other tools to Pi ([ec546a4](https://github.com/Navin009/auto-permission-system/commit/ec546a4100df045d4b56f8fa2b3f9c5a51cc61e6))


### Reverts

* Revert "fix(tool-view): keep command runs together across native thoughts" ([ebb8bda](https://github.com/Navin009/auto-permission-system/commit/ebb8bdaf398d7082da7e8094ef35fcfed189f3bb))


### BREAKING CHANGES

* ~/.ssh is no longer in denyRead. The sandbox no longer masks
  the directory with an empty tmpfs, so ssh can read known_hosts and
  git-over-ssh fetch/push works again. L1 bash can now read key material
  without a prompt; L2 still hard-denies it for the model's own tools, and
  ~/.ssh stays in denyWrite.

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
