# ADR-017: Ask before commands that can print secrets

**Status:** Accepted

## Context

Provider API tokens live in pi's environment. A sandboxed bash command can print
them with `printenv` or `env`, or read them as a file via the per-process
`/proc/<pid>/environ`. sandbox-runtime can mask credential env vars, but only
when `credentials.envVars` is configured — and it is not, so today
`printenv` in the sandbox returns real token values.

`denyRead` does not help: an environment dump reads no path the policy can name,
and `modelDenyRead` only covers the model's `read` tool, not bash.

## Decision

- **Default `commands.ask` list.** `sandbox.default.json` ships
  `"commands": { "ask": ["printenv", "env", "/proc/*/environ"] }`.
- **Layer 1 gates them.** Before a command runs, `preflightSensitiveCommands()`
  matches the command against the list and, on a hit, asks
  (`Block (default)` / `Allow once`). Deny returns `exitCode: 1` and the command
  does **not** run — the agent sees
  `command blocked — it can print secrets: … Nothing was run — ask the user.`
  Every decision is audited (`note: "sensitive-command"`).
- **Matching** (`src/core/policy/commands.ts`, pure): an entry without `/` or
  `~` is a command name and matches the head of a simple command; an entry with a
  path is globbed against every path token in the command, so any reader of the
  proc environ file is caught. Segments are split on `; && || |` first, so a
  chained `echo hi && printenv` is inspected too.
- **No "remember" yet.** The gate offers only `Allow once`; per-command
  persistence would need a new override kind. The list itself is user-tunable in
  `sandbox.json`, which is the intended way to relax it.

## Consequences

- A token dump cannot be silent: `printenv`, `env`, `/proc/<pid>/environ` reads
  prompt first (or are blocked).
- Deliberately conservative matching over-prompts in two cases: `env FOO=bar cmd`
  (which runs a command, not a dump) and `echo /proc/self/environ` (which just
  prints the path). Both ask rather than leak; a user who dislikes a prompt can
  remove the entry from their `commands.ask`.
- Environment variables are still masked only if `credentials.envVars` is
  configured. This gate is a visible control in front of the leak, not a
  substitute for masking; wiring `credentials` for `*_KEY` / `*_TOKEN` /
  `*_SECRET` names is a possible follow-up.
- `security/tests/unit/ask-commands.mjs` locks the matching rules.
