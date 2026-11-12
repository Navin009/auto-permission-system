# ADR-052: A group survives a turn that only calls tools

**Status:** Accepted — amends the break list of ADR-050 §2.

## Context

ADR-050 §2 lists a `turn_start` as a break, and `extensions/tool-view.ts` closed the open group on
that event. The reasoning behind it was that a turn is what a user sees as "one reply", so a turn
boundary is a natural place to stop grouping.

Pi's turn is narrower than that: "a turn is one assistant response plus any tool calls and tool
results produced by that response" (`docs/json.md`). A model that calls one tool at a time — the
common case — therefore ends a turn between every two commands. The group closed before the next
command could join it, and every stretch of shell work drew one `Running 1 command` row per call,
which is exactly what R10 and `docs/TOOL_ROWS_VIEWS.md` §1 say must not happen:

```text
✓ Running 1 command · 123ms
   └ $ grep -rn "bash\|powershell" src/…
✓ Running 1 command · 145ms
   └ $ sed -n '1,20p' src/core/tool-view/labels.ts
✓ Running 1 command · 139ms
   └ $ sed -n '30,60p' extensions/tool-view.ts
```

`Running 2 commands` was reachable only for tool calls batched into one response.

## Decision

1. **A turn boundary is not a break by itself.** The `turn_start` handler is gone.
2. **Visible text is the break.** `turn_end` closes the open group when the finished assistant
   message carries a non-empty text block; a message that only calls tools leaves the group open.
   The rule lives in the pure `src/core/tool-view/message-text.ts` (`carriesVisibleText`), so the
   extension stays a wire-up and the rule is testable without pi.
3. **The other breaks stand.** Any non-command tool call, a user `message_start`, `/tool-view full`
   and `session_shutdown` still close the group (ADR-050 §2).
4. **Thinking does not break.** A `thinking` block is not text, so a thought between two commands
   still does not split the group, as ADR-050's consequences require.

## Consequences

- Three sequential `bash` calls over three turns now draw one `✓ Running 3 commands` row, and the
  frames in `docs/TOOL_ROWS_VIEWS.md` §1 and §2 are reachable.
- Prose still splits groups, so the §4 frame (`$ ls` row, an explanation, `$ cat` row) is unchanged:
  the group closes when the explanation arrives, not when the next command starts.
- A reply that both writes text and calls a command closes the group after that command's tools
  finish, so the text sits below the row and the next command opens a new one. Text can never be
  drawn between two calls of one response, so there is no ordering case to resolve.
- The rule reads the message pi hands to `turn_end`; a future pi that reports a different message
  shape would leave groups open longer (one row per stretch instead of one per call), never hide a
  call or a mark.
