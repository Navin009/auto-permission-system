# ADR-048: Tool view — a display-only renderer, separate from the security layers

**Status:** Accepted

## Context

A turn with 20 tool calls prints 20 blocks. The user scrolls to find one answer, and the
outcomes that matter — a blocked write, a denied prompt, a refused network call — are buried in
the same wall of output. Two prototypes proved the idea is drawable: `pi-cc-tools` (one live
line, achieved by patching Pi's `ToolExecutionComponent`) and `pi-minimal-toolcall` (one row per
proximity group, through the public `registerToolRenderer`).

This package exists to make Pi safe, not to change how Pi looks. Anything that renders must
therefore be unable to influence a decision, and must be removable without touching a policy.
The requirement set is `docs/TOOL_ROWS_REQUIREMENTS.md`; the accepted appearance is
`docs/TOOL_ROWS_VIEWS.md`.

## Decision

1. **A separate extension, not a feature of the guard.** `extensions/tool-view.ts` is its own
   `pi.extensions` entry, with `src/tool-view/` for the wiring and `src/core/tool-view/` for the
   pure row logic. It imports nothing from `src/l2-guard/`, `src/l1-sandbox/` or `src/detect/`,
   and none of them import it. Removing one manifest line removes the feature.
2. **The public renderer API only.** `pi.registerToolRenderer` supplies `renderCall` /
   `renderResult`; no prototype patching, no `addChild` overrides, no reading Pi internals. A Pi
   upgrade can change what a row looks like, but it cannot break a renderer into silence.
3. **Two values, one switch, safe default.** `compact` or `full`; nothing else. `full` is stock
   Pi output and is the default, so an existing install changes nothing until the user asks.
   The choice lives in `~/.pi/agent/tool-view.json` (`{"view": "compact"}`), never in
   `sandbox.json` — display must not share a file with the trust boundary. Unreadable or missing
   settings resolve to `full`.
4. **Per-call rows in v1.** One row per tool call, with a second line carrying the command for
   shell calls. Grouping consecutive shell calls under one `Running N commands` header (and
   therefore clicking a single line inside a group) needs the container patch this ADR rejects,
   so it is deferred rather than approximated.
5. **Collapsing may never hide a security outcome.** A blocked, denied, asked or errored call is
   labelled on the row (`✗ blocked`, `✗ denied`) and still counted; only the body is collapsed.
   `write` is never collapsed at all — the file content is what the user came to read.
6. **Thinking and messages are Pi's.** The renderer does not draw thinking blocks, hidden-thinking
   labels, or queued `Steering:` / `Follow-up:` messages; it never groups across them, so `full`
   and `compact` show the same thinking content Pi shows today.

## Consequences

- Turning the view off is one command and one settings key; a broken renderer degrades to Pi's
  own output (the resolver simply is not consulted for tools it does not own, and `full` paths
  delegate to the next renderer unconditionally).
- The model-facing prompt is untouched: no schemas, descriptions, snippets or `execute` changes,
  so a security review of the tool surface stays valid.
- We accept a smaller v1 than the view doc's group frames: no `Running 2 commands` header, no
  per-line click, no `Reading 3 files` rollup. Reopening that needs a spike proving a per-line
  click is reachable without patching Pi; if the spike fails, the patched variant must be a
  second opt-in extension so this ADR's separation still holds.
- `write` staying expanded is a deliberate exception, not a missing feature: a file being written
  is an update the user should read without asking.
