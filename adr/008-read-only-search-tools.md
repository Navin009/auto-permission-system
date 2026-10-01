# ADR-008: Gate read-only search tools and filter grep output

**Status:** Accepted

## Context

Layer 2 gated `read` but not pi's other read-only tools: `grep`, `find` and `ls`. `grep` returns file contents and runs ripgrep inside the pi process, so the Layer 1 bash sandbox never sees it either. `grep "." ~/.aws/credentials` therefore returned the file even though `~/.aws` is in the absolute-deny tier, and a `grep -r` over `~` searched `~/.ssh`. `find` and `ls` return names only, but they listed denied directories the same way.

A gate on the search root alone is not enough. Basename patterns such as `.env`, `*.pem` and `*.key` can match files anywhere beneath an allowed root, and ripgrep does not know the policy.

## Decision

1. **Root gate.** `grep`, `find` and `ls` go through `isDeniedRead` on their `path` (default `.`), with the same canonicalization, ask-tier prompt and absolute-deny tier as `read`.
2. **Output filter for grep.** A `tool_result` hook drops every output line whose file is denied by the read policy, before the result reaches the model. It parses pi's grep format (`path:N: text` for a match, `path-N- text` for a context line), resolves each path against the canonical search root, and appends a one-line note with the number of lines and files removed. Each redaction is written to the audit log.
3. **Approving a root does not approve the denied files beneath it.** A "yes" for a search root applies to the root only. Denied files under it stay filtered.
4. **Single-file searches** print only the basename, so the filter skips them. The root gate already decided for that one file.
5. The parsing lives in `lib/guard-lib.ts` with no pi imports, so `security/tests/grep-filter.mjs` imports and tests the real code.

## Consequences

- `grep` can no longer read a denied file directly or as part of a wider search.
- `find` and `ls` still print names under an allowed root, including the names of denied files. Names only, accepted.
- The filter depends on pi's grep output format. If pi changes it, unparsed lines are kept, so the failure mode is that nothing is filtered, and `grep-filter.mjs` must be updated alongside.
- ripgrep does not follow symlinks while it walks a directory, and the root gate canonicalizes the root itself (ADR-006), so a symlink inside the root cannot redirect a search.
