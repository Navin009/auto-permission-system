# ADR-040: The ask prompt bounds its evidence instead of dumping matched lines

**Status:** Superseded by ADR-042 (row windowing and the row cap)

## Context

ADR-018 defines the Advanced Secure tool-output gate: a secret-like hit prompts
the user before the output reaches the model, showing `Tool  <subject>` and one
`Finding  <lineNo>: <line>` row per matched line. Two shapes of output broke
that prompt in practice:

1. **One enormous line.** `ps aux | grep node` is one row per process, and a
   sandboxed process row carries every `--setenv` proxy variable. The evidence
   row was thousands of characters of base64-encoded proxy credentials, wrapped
   over the whole terminal, so the question and its choices were pushed off
   screen — the prompt was unusable exactly when it mattered.
2. **A hit no line could be pointed at.** Evidence rows were derived by
   diffing the raw blob against the scanner's redacted copy. Redaction covered
   `scheme://user:pass@host` but not `?param=value`, so a URL *query* credential
   was reported (`URL_CREDENTIAL`, score 75, decision `ask`) with an empty
   evidence list. The prompt rendered the header, the question, and the choices
   with nothing between them: the user was asked to allow or hide output with no
   indication of what was found.

Intake also produced false positives that fed (2): `fetch(\`/api/x?token=${encodeURIComponent(token)}\`)`
was read as a literal query credential, because the capture class swallowed the
trailing `` `); `` and the value `"${...};"` is not a placeholder by the old
rule.

## Decision

- **Evidence rows are bounded.** At most 10 `Finding` rows, each windowed to
  ~160 characters centered on the first character that differs between the raw
  and redacted line, with `…` at the cut. Overflow becomes one
  `Hidden   N more detected line(s) not shown` row. Rows stay readable, and the
  matched context survives the cut.
- **The user still sees the raw slice.** The row is the real line (not the
  redacted one) because the human being asked is the trusted party; only the
  window is bounded.
- **The prompt is never contentless.** When a block is flagged but no line can
  be located by diff (whole-content detector, or a redaction that removed
  lines), rows fall back to the scanner's finding labels and previews.
- **Index diffing requires equal line counts.** Redaction can delete lines (a
  PEM block collapses to one marker); the gate only diff-maps when the raw and
  redacted blobs have the same number of lines, otherwise it uses the fallback.
- **CRLF output is not "changed".** A line ending is compared without its `\r`,
  so Windows output does not report every line as a finding.
- **Redaction covers query credentials.** `redactText` now replaces
  `?param=<value>` (`URL_QUERY_CREDENTIAL_REGEX`, global) in addition to
  `user:pass@host`, so the diff can locate the line and an approved blob does
  not keep the value in its redacted copy.
- **Template interpolation is a placeholder.** `${...}` — in any shape, and as a
  capture-span prefix — is code, never a literal secret, so
  `?token=${encodeURIComponent(token)}` no longer asks. The query-credential
  value class also stops at quoting/code punctuation (`` ` ``, `;`, `)`, `}`,
  `<`, `>`).
- **Every match is checked, not just the first.** `CONNECTION_STRING_REGEX` and
  `URL_QUERY_CREDENTIAL_REGEX` were consulted with a single non-global `exec`,
  so `?token=<placeholder>` earlier in the blob hid a real credential later.
  A helper now scans all matches and flags when any value is not a placeholder.

## Consequences

- The prompt fits the terminal for pathological output and always explains
  itself; the `Finding` row format and numbering are unchanged, so the contract
  test for the format still holds.
- Long lines are no longer reproduced verbatim in the prompt. A user who needs
  the full line can approve and read the tool output itself.
- Query-credential detection is slightly narrower (no trailing punctuation in
  the captured value) and slightly broader (every match, not the first).
- `security/tests/unit/exposure.mjs` and `security/tests/unit/detect-smoke.mjs`
  lock the window, the cap, the fallback, CRLF handling, the interpolation
  placeholder, and the multi-match scan.
