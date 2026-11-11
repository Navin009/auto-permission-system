# ADR-049: A name is not a read, and `find` is parsed as `find`

**Status:** Accepted

## Context

The read pre-flight asked for `.env` on a command that never opened it:

```
cd ~/workspace/auto-permission-system && ls -a | grep -i -E "markdownlint|vscode" ;
find . -maxdepth 2 -name ".markdownlint*" -not -path "./node_modules/*"
```

`readPathCandidates` walked `find` like any other read command: every
non-flag token was a path, and because `find` is in
`RECURSIVE_SEARCH_COMMANDS` every target folder was listed in full. Four
things went wrong at once.

- `-name ".markdownlint*"` is a **filter**, but the walk ignored it, so
  `.env` became a candidate even though `find` can never print it.
- `-maxdepth 2` is a **bound**, but the walk was unbounded, so
  `demo/test-workspace/.env` was a candidate too.
- `-path "./node_modules/*"` is a **predicate value**, but it was resolved
  as a glob and each match — a real `node_modules/<package>` folder — was
  walked recursively, adding `node_modules/bottleneck/.env` and
  `node_modules/nerf-dart/.npmrc` to a command that *excludes* them.
- `find` prints **names**, never contents, yet the prompt said "the AI will
  see any keys in it".

A second class fired the same prompt: `shellSegments` split the command on
`\n`, so a heredoc body — data written into a file — was parsed as commands.
Writing a script or a doc that merely *mentions* `find .` asked for `.env`.

The prompt itself was hardcoded to `.env`: `File / Why / Risk / Note` named
the `.env` file and its secrets for every `askRead` entry (`*.pem`,
`id_rsa`, `~/.aws`, `~/.npmrc`, `credentials`), and it printed neither the
command nor the rule that matched. "Can't be saved as a permanent rule"
described the effect and left out the reason.

Prompt fatigue is the security cost here: a guard that asks about a file
listing teaches the user to deny without reading.

## Decision

- **`find` gets its own grammar** (`src/core/policy/find-query.ts`). The
  tokens before the first predicate are the targets; a value predicate
  (`-name`, `-path`, `-type`, `-size`, `-maxdepth`, ...) consumes its value
  and the value is never a read target; `-maxdepth`/`-mindepth` bound the
  walk; `-name` filters what can be printed; `-not -name` and `-not -path` are
  **exclusions**, matched case-sensitively with `*` crossing `/` the way
  find's own `fnmatch` does. Anything the parser cannot read safely — the
  `-exec`/`-ok`/`-print`/`-delete` family, `-o`/`-or` (where a candidate is one
  branch of an alternation), and any other negated value predicate (`! -size`)
  — returns "not understood" and falls back to the old unfiltered walk. The
  fallback is deliberate: reading a negation as an inclusion would drop files
  the command *does* print, which is the one direction a guard must not fail
  in. Over-reporting a `-printf` is survivable; missing `-exec cat` is not.
- **A heredoc body is data** (`shellSegments`). The segmenter scans each line
  for `<<WORD` / `<<-WORD` / `<<'WORD'` outside quotes, and skips every line
  up to the delimiter. `<<<` (herestring) and a `<<` inside a quoted string
  are not markers.
- **An exposure travels with every candidate**: `Name` for `ls`, `find`,
  `tree`, `du`, `stat`, `readlink`, `realpath`, `dirname`, `basename`, `cd`;
  `Content` for everything else (`cat`, `grep`, `rg`, `jq`, `base64`,
  interpreters, archivers). Content wins when one command does both.
- **A name-only listing inside the project does not prompt**
  (`preflightAskReads`). The AI can already enumerate project files through
  the `read`/`glob` tools, so the prompt bought nothing and cost a decision.
  The run is audited as `ask-read-name-only`. Outside the project a
  name-only listing still asks — that boundary is about *where*, not *what*
  — and says that only the name is exposed.
- **The prompt describes the rule that fired**: `askReadFindings` reports the
  matched pattern, the title uses the credential label for the path
  (`getCredentialLabel`), and the body is `File / Command / Risk / Why /
  Note`, with `Why` from `displayWhy` and one shared `CREDENTIAL_NOTE` for
  both the read and the write prompt. The command is flattened and capped at
  `MAXIMUM_COMMAND_DISPLAY_LENGTH`.

## Consequences

- The reported command yields zero candidates. `find . -name "*.env"`
  prompts for the `.env` files it can print and no longer for
  `node_modules`; `find . -type f` reports name-only and does not prompt
  inside the project.
- `matchesGlob` is exported from `patterns.ts` (the glob compiler behind
  `matchesPolicyPattern`) so an exclusion and a policy pattern cannot drift;
  the policy matcher keeps its platform case-insensitivity, a find exclusion
  is case-sensitive on both platforms as find is.
- `askReadCandidates` keeps its signature (pattern list in, path list out)
  and is now a projection of `askReadFindings`; the outside-project walk and
  the write pre-flight are unchanged.
- A credential that a **content** read names still prompts exactly as
  before, one file at a time, never remembered (ADR-046).
- `-exec` and `-o` keep today's over-reporting behaviour; a future ADR can
  read `-exec` as a nested command instead of falling back.
- `listDirectoryFiles` takes an optional `maximumDepth`; the option seam
  (`PathCandidateOptions.listDirectory`) passes it through.
- Prompt text is pinned in three places that must move together:
  `src/l1-sandbox/bash-preflight.ts`, `docs/ask-examples.md` §4, and
  `security/verify-prompts.mjs` §4.
