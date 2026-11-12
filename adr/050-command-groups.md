# ADR-050: Command groups come from render order, not from a container patch

**Status:** Accepted — supersedes ADR-048 §4 (`Per-call rows in v1`) and narrows ADR-048 §2 to
shell commands.

## Context

`compact` drew one row per tool call, so a stretch of shell work

```text
ls ; find . -maxdepth 2 -name ".markdownlint*" ; rg -n "tool view"
```

printed three `✓ Running 1 command · 0ms` rows. Read next to each other, three rows say "three
moments"; the user wanted one line of work. `docs/TOOL_ROWS_VIEWS.md` §3.5 already drew the target
(`● Running 2 commands · 5s` plus a `└` line per command), and ADR-048 §4 deferred it because
merging separate tool executions looked like it needed the `ToolExecutionComponent` patch that ADR
rejects.

Two facts about the public renderer API make the deferral unnecessary:

- Pi resolves the renderers for a call (`resolveToolRenderers(toolName, base)`) once, when it
  builds that call's component, in transcript order. Every tool name goes through the resolver,
  including ones we do not render.
- With `renderShell: "self"`, a component that renders no lines takes no space at all: Pi returns
  `[]` instead of a block, so a suppressed call leaves no blank line behind.

Together they are enough for one call's component to draw the whole group and the others to draw
nothing.

## Decision

1. **`compact` compacts shell commands and nothing else.** `read`, `edit`, `write`, `ls`, `grep`,
   `find`, `codemode` and every MCP or extension tool keep Pi's own renderers and Pi's own frame,
   in both views. The resolver hands those tools straight back to Pi, so their styling cannot drift
   from Pi's. The per-call file rows of v1 are gone with their labels table, their components and
   their clock; only `bash` and `powershell` are ours.
2. **A group is adjacency in render order.** The first shell call after a break opens a group;
   every following shell call joins it. A break is any tool call that is not a shell command
   (owned by us or not), a `turn_start`, a user `message_start`, a switch to `full`, or
   `session_shutdown`. Nothing is inferred from the session file.
3. **One drawer, no patch.** The first member's component renders the whole group —
   `Running <N> commands · <total>` plus one `└ <mark> $ <command> <duration>` line per command,
   newest eight, older ones behind `└ ... (<N> earlier calls)`. Every other member returns an empty
   component. No prototype patching, no `addChild` override, no internal field read: the mechanism
   stays inside `pi.registerToolRenderer`, as ADR-048 decided. `renderShell: "self"` is what makes
   an empty component take no space at all — the same declaration makes the group row flush-left,
   which is the frame the view doc draws.
4. **The group is the live model.** Members are `{ toolCallId, command, status, duration,
   startedAt, settledAt }` in `src/tool-view/command-groups.ts`; text is built by the pure
   `src/core/tool-view/command-group.ts`. Every member keeps the `invalidate` of its own render
   context; joining or settling invalidates the drawing member, and one ticker per group
   invalidates it while any member runs. A re-entrancy flag plus "read the model at render time"
   means a repaint can never recurse.
5. **A single command is a group of one**, so there is one code path: `Running 1 command` with a
   plain `└ $ <command>` second line, exactly the row v1 already shipped.
6. **Durations get sub-second precision** (`320ms`, `1.2s`, `12s`) on command lines and on the
   group total, so a fast group no longer reads `· 0s`.
7. **Expansion stays Pi's.** `ctrl+o` expands the group; each member then draws Pi's own renderers
   for that call, in order, with nothing of ours in between. The header row is replaced by those
   blocks rather than staying above them.
8. **Security outcomes are never collapsed away.** Each `└` line carries its own mark
   (`✓` / `✗` / `…` / `✗ blocked` / `✗ denied`) and the header takes the worst of them
   (`✗ denied` > `✗ blocked` > `✗` > `●` > `✓`).

## Consequences

- A group is a display artifact only: nothing is written to the session, the model-facing tools are
  untouched, and every security decision is identical in both views.
- The view can only ever restyle compression of shell commands. If Pi changes how a file block
  looks, `compact` follows for free — one reason to keep the resolver's hand-back for everything
  that is not a shell command.
- Not delivered by this mechanism, and still listed as open in
  `docs/TOOL_ROWS_REQUIREMENTS.md` §10: output drawn under the running command (`R11`) and
  clicking one `└` line to open only that command (`R14`, `R16`). Pi gives a mouse region per
  execution component, not per line inside a renderer's own component.
- A thought between two commands does not split the group yet (`R19`): the renderer never sees
  Pi's thinking block.
- The suppression trick depends on `renderShell: "self"` keeping its "no lines, no space"
  behaviour. If a Pi upgrade changes that, the failure mode is more headers (one per call), never
  hidden output or a hidden mark.
- A group row is flush-left: `renderShell: "self"` means we draw our own frame, so an expanded
  command shows Pi's own renderer for that call without Pi's outer padded box. The content is Pi's,
  unchanged; only the frame around it lacks the one-column indent and background.
- The drawing member holds the other members' lines, so `/reload` rebuilds groups from transcript
  order; a replayed group loses its live timing but keeps its commands, marks and durations.
