# ADR-045: The bash pre-flight parses the shell, not the command name

**Status:** Accepted

## Context

Layer 1 read protection was a fixed allowlist: `READ_COMMANDS` (about 25 names).
A segment whose head was not in that list contributed no candidates, so the
pre-flight never saw the operand:

```text
node -e "readFileSync('.env')"     base64 -w0 .env      sh -c 'cat .env'
cp .env /tmp/copy.txt              tar cf out.tar .env  dd if=.env
cat $(echo .env)                   cat .e*              COLUMNS=80 cat .env
```text

Three separate mistakes were behind it: the command list was too short, a shell
wrapper hid the real command, and a token was only compared if it was spelled
exactly like the file (never a glob, never embedded in a script argument).
Writes had no pre-flight at all, so `filesystem.askWrite` was dead config and
`echo x > .env` was silent.

## Decision

- **`src/core/policy/shell-command.ts`** owns the shell structure:
  `shellSegments` (operators, `&`, newlines), `shellTokens` (quotes, subshell
  parens), `commandHead` (skips `VAR=x` prefixes and wrapper flags), and
  `commandSegments` (recurses into `sh -c` / `bash -lc` and `$(…)` / backticks,
  depth 3).
- `readPathCandidates` uses that structure. A segment counts as a read when its
  head is in `READ_COMMANDS`, which now also lists the binaries that genuinely
  read a file (`cp`, `tar`, `base64`, `node`, `python3`, `git`, `openssl`, …).
  Argument tokens are scanned for embedded paths, so an interpreter's inline
  script (`node -e "…'.env'…"`) yields a candidate.
- **Globs are expanded** per directory (`cat .e*` → `.e*` → `.env`).
- **A recursive search verb over a folder is walked** (`grep -r KEY .`), so the
  files beneath a directory root are candidates too.
- **Write candidates** are redirect targets (`>`, `>>`, `2>`), `of=`, `tee`
  operands, copy destinations, `touch`/`rm`/`chmod`-style operands and in-place
  edits (`sed -i`, `perl -i`). A plain `sed -n 1p .env` stays a read.
- **Layer 1 enforces the write tier**: `preflightWriteAccess` hard-blocks a
  `denyWrite` match and asks for an `askWrite` match, with the same
  once / session / fail-closed-when-headless shape as `preflightAskReads`.
- **The shipped baseline states the hardening it relies on**: `denyRead` names
  the credential folders and `denyWrite` names the secret files, instead of
  relying on the built-in constants that the shipped file was silently
  replacing.

## Consequences

- The four commands above now ask (`askRead`) or are blocked (`denyWrite`).
- `env FOO=1 python app.py` no longer matches the `env` ask entry: the wrapper is
  traversed, so only a command that actually prints the environment asks. This
  removes the over-match ADR-017 documented.
- **Obfuscation is still possible.** A path built at runtime (`p=$(printf …)`)
  or read by a program that never spells it (a compiled helper, a script file)
  is not seen. The pre-flight is a prompt, not the boundary: the OS fence and
  `denyRead` remain the enforcement for paths that matter. This is recorded as a
  manifest known gap.
- Cost: a command containing a glob or a recursive search over a folder now does
  a bounded `readdir` (1000 entries, `node_modules`/`.git`/build output skipped)
  before running.
