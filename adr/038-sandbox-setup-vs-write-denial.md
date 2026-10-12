# ADR-038: A bwrap mount-setup failure is not a write denial

**Status:** Accepted

## Context

sandbox-runtime always read-denies two project paths that can carry
agent/prompt definitions: `.claude/commands` and `.claude/agents`
(`getDangerousDirectories()`). On Linux it implements that deny by binding a
placeholder over the path. When the project has a `.claude/` directory but no
`.claude/agents`, bubblewrap has to create the placeholder destination itself,
and under sandbox-runtime's `--ro-bind / /` root that fails:

```text
bwrap: Can't create file /…/project/.claude/agents: Read-only file system
```

Layer 1's post-block handler matched `read-only file system`
(`isBlockedAccessError`), treated it as the command being refused a write, and
(ADR-022 / ADR-037) recovered the operand and offered a write grant. The path
is **inside** the project and under `allowWrite: ["."]`, so the prompt said
"not under an allowWrite root" and "outside your project" about a path the
policy already allows — and no `once` / `session` / `remember` grant could ever
change the outcome, because the refusal happens before the command runs.

ADR-037's lead-in handling made the string noisier still: it did not know the
`bwrap: Can't create file ` prefix, so it returned
`<cwd>/Can't create file /…/.claude/agents`.

## Decision

- `extractBlockedPath` strips the `bwrap: ` and `Can't create file ` /
  `failed to create file ` lead-ins, so the masked path is recovered correctly.
- Layer 1 records whether the output came from bubblewrap's own setup
  (`sandboxSetupError`). A setup failure is treated as such only when it is not
  a hard deny or an outside read, and the recovered operand is absent or under
  the project cwd — the mandatory masks are project-relative. Then no grant is
  offered: audit `note: "sandbox-setup-error"`, notify, and print a plain "the
  OS sandbox could not start" block instead of the misleading allowWrite hint.
- The cwd scope keeps a genuine outside write on its normal grant flow: if
  bubblewrap also printed a setup line, a recovered operand outside the project
  still goes through the outside-project / write prompt.

## Consequences

- The `.claude/agents` case no longer prompts and no longer claims an
  in-project path is outside it; the user sees one accurate setup-error line.
- An outside write the sandbox genuinely fences still prompts, because the
  setup-error branch fires only when no operand was recovered or the operand is
  under cwd.
- The generic block hint is cleared for a setup failure, so it no longer says
  "not under an allowWrite root" about a path that is under one. A real outside
  write keeps the normal hint.
- Regression coverage: the bwrap line in
  `security/tests/unit/l1-attribution.mjs`, and "does not prompt / reports setup
  error / hides the misleading hint" in
  `security/tests/unit/l1-session-grants.mjs`.
