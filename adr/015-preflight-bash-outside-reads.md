# ADR-015: Layer 1 asks before an outside-project bash read; no silent truncation

**Status:** Accepted

## Context

ADR-014 extended `filesystem.outsideProject.read` to `bash` by fencing the home directory at the OS layer and re-exposing the project, `allowWrite` roots and `outsideProject.allowRead` via `allowRead`. It assumed that when the mode is `ask`, "the command fails with `EPERM`" and the existing post-block hook then prompts.

That assumption is false for **directory reads**. sandbox-runtime implements `denyRead` on Linux as a tmpfs that *hides* a directory, not as a permission error. So with `outsideProject.read: "ask"`:

```text
$ ls -la ~/.pi/agent/
-rw-r--r-- ... install
-rw-r--r-- ... npm
```

exit code 0. Only the paths `allowRead` re-exposed appear; everything else is silently removed. No `EPERM` reaches the post-block hook, so the user is never asked, and the model receives a **wrong, silently truncated listing** and may draw conclusions from it. This is worse than a hard block: the failure is invisible.

## Decision

- **Pre-flight ask in Layer 1's bash wrapper.** `createSandboxedBashOps().exec` computes `outsideProjectReadCandidates(command, cwd, home, filesystem)` before wrapping the command. When the mode is `ask` and the command plainly names an outside-project path, the user is prompted **before the command runs**. The prompt offers `no — block this command` (default, pre-selected), `yes — this once (don't save)`, and the two persistent `always` grants (`overrides.allowRead`). "This once" is handed to `SandboxManager.wrapWithSandbox` as a per-invocation `customConfig` — nothing is written and the session sandbox is not re-initialised; "always" persists and then runs. Deny returns an explicit refusal and **runs nothing**. The response is all-or-nothing — complete real output, or a clear refusal — never a trimmed listing.
- **Best-effort detection, fence as backstop.** `outsideProjectReadCandidates` (pure, in `lib/guard-lib.ts`) splits the command on `;` `&&` `||` `|`, keeps only segments whose head is a read-like command (`ls`, `cat`, `find`, `grep`, `rg`, `fd`, `head`, `tail`, `stat`, `cd`, …), expands `~` and resolves path tokens that exist on disk. Hard `denyRead` matches are never candidates. Reads the scanner cannot see (variable expansion, nested shells, interpreted scripts) are **not** prompted: they still hit the ADR-014 fence and stay masked. The pre-flight is an improvement over silent truncation for the common case, not a replacement for the OS boundary.
- **`outsideProject.allowRead` stays silent.** Paths already covered (`~/.pi/agent/install`, `~/.pi/agent/npm`, the project, `allowWrite` roots) never prompt, so pi's own runtime keeps working without interruption.
- The ADR-014 fence and the EPERM post-block hook remain for `deny` mode and for writes; only the `ask`-mode directory-read gap is closed here.

## Consequences

- With `outsideProject.read: "ask"`, `ls ~/.pi/agent` prompts; on allow it lists everything (explicit file denies still mask contents), on deny the command does not run. No more empty/partial listing reaching the model.
- Pre-flight adds one `loadConfig()` read per bash command; negligible next to sandbox startup.
- False positives are possible for a read-like command whose argument is an existing path that is never actually read (for example `grep pattern /etc/hostname`-style literals); the user can deny, which blocks the command. This is accepted in exchange for never returning silently-wrong output.
- The prompt is per path, sequentially. It offers a true `this once` (no persistence, no reload) alongside the existing persistent read-grant options, and every choice is audited (`note: "preflight"`).
- `security/tests/outside-fence.mjs` locks the candidate shapes (11 new checks).
