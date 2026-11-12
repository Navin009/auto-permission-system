# Feature: tool view — compact tool rows (display-only)

**Status:** v1 implemented, scope narrowed by ADR-050: `compact` compacts consecutive **shell**
commands into one `Running <N> commands` row and leaves every other tool on Pi's own renderer. See
§10 for what shipped and what is not drawn. What the view looks like is settled in
[`TOOL_ROWS_VIEWS.md`](./TOOL_ROWS_VIEWS.md); the decisions still open are listed in §6.
**Owner doc:** this file is the single place requirements are settled. When the open decisions
(§6) are closed, the accepted ones move to `adr/048-tool-view.md` (number at creation time) with
`Status: Accepted`, and this file keeps only the requirement list.

---

## 1. Problem

A turn with 20 tool calls prints 20 blocks. The user scrolls to read one answer, and the
security outcomes that actually matter (a denied write, an ask, a blocked network call)
are buried in the same wall of output.

Reference implementations are cloned read-only under `.ref/` (git-ignored):

| Reference | Version | What it proves |
| --- | --- | --- |
| `.ref/pi-cc-tools` | 0.8.6 | one live line, prototype patching |
| `.ref/pi-minimal-toolcall` | 0.5.0 | one row per proximity group, public renderer API |

Full architecture notes for both are in the session that created this doc; the takeaways
that matter for us are in §7.

---

## 2. Goal

Add a **separate, optional, display-only** part of `auto-permission-system` that renders
tool calls as compact rows: one line per call while it runs, one line per command when several
run in a row. It must be possible to turn it off and get today's stock Pi output back with no
restart, and turning it on must not change a single security decision.

**Success looks like:** with the feature on, a 20-call turn fits on one screen, every
denied/asked call is still visibly marked, and `./security/check.sh` still passes
untouched.

---

## 3. Scope

In scope:

- Rendering of shell call rows in the TUI transcript (call + result), grouped by proximity.
- Which tools take part in that: `bash` and `powershell` only (ADR-050). Everything else stays
  Pi's own block, so its styling can never drift.
- A two-value view switch — `compact` / `full` — persisted between sessions. There is no
  separate "off": `full` **is** stock Pi output, so it plays the disabled state (`C5`).
- Unit + contract tests for the above, in the existing harness.

Explicitly **not** in scope (these stay exactly as they are today):

- L2 guard decisions, L1 sandbox policy, ask prompts, permission modes, audit log.
- Tool schemas, descriptions, prompt snippets, `execute` — the model must see byte-identical
  tools (same rule `pi-minimal-toolcall` follows via `registerToolRenderer`).
- Session transcript semantics. Any persistence (§6 D11) is a display-only hint, never
  source of truth for counts.
- New runtime dependencies.

---

## 4. Hard constraints

C1. **No new runtime deps.** `dependencies` stays `@anthropic-ai/sandbox-runtime` only.
C2. **Thin entrypoint, pure core.** Formatting/counting logic goes in `src/core/rows/`
    (no `pi`/OS imports, so it is unit-testable like the rest of `src/core`). The Pi
    component/timer wiring goes in a new `src/tool-view/` module. The entrypoint only wires.
C3. **Never hide a security outcome.** A call that was blocked, denied, asked or errored
    must be recognisable without expanding: `✗` plus a short word (`blocked`, `denied`,
    `asked`). Collapsing is allowed; silence is not.
C4. **Never fight the ask overlay.** ADR-041 / ADR-043 fixed the ask body viewport and
    question rows. A live row may not reserve vertical space while an ask is on screen,
    and must not steal focus, keys or mouse events.
C5. **Kill switch in one action.** `/tool-view full` (and the settings menu) restores stock
    output immediately, no reload, no restart, and leaves nothing behind — no row, no timer,
    no reserved slot, no key or mouse handler. Persisted, so the next session agrees.
C6. **Reuse the existing test harness.** `security/tests/{unit,contract}/*.mjs` run through
    `tests/ts-loader.mjs`, print `PASS=`, one file per process. No new runner, no new dep.
C7. **Width and platform safe.** Every row goes through `truncateToWidth`; ANSI escapes never
    count toward width; `powershell` covered like `bash`; no literal control characters in
    source.
C8. **Quiet in non-TUI modes.** `print` / `json` / `rpc`: no timers, no `requestRender`, no
    animation. Anything armed is disarmed on `session_shutdown` and `agent_end`.
C9. **Reload-safe.** `/reload` must not stack wrappers, must keep the current turn's rows,
    and must not leave a dead timer invalidating a dropped component.
C10. **Colour is never the only signal.** `●` / `✓` / `✗` / `…` glyphs carry the meaning;
    a theme without concrete colours degrades to a static dot.

---

## 5. Requirements

Numbered so a test can name one. `M` = must, `S` = should, `C` = could.

Every row requirement below describes the **`compact`** view. `full` is stock Pi output and has
no requirements of its own beyond `C5` (mode switch) and `R22` (it must draw exactly what Pi
draws today). There is no summary band, no footer and no end-of-turn line in either view
(`R23`).

### Row shape

| # | P | Requirement |
| --- | --- | --- |
| R1 | M | A row reads `<mark> <Verb-ing> <count> <noun> (<target>) · <Ns>`: column 1 is the mark (`●` while it runs, `✓` / `✗` once finished), the count wraps a run of same-kind calls, `(<target>)` names the most recent one. |
| R2 | M | The verb never flips when the call finishes: a row keeps its words, the mark in column 1 turns from `●` into `✓` / `✗`, and its duration freezes. No tense change, no relabelling on settle. |
| R3 | M | A shell row carries a second line with what it runs: `└ <mark> $ <command>`. Other tools carry no second line. |
| R4 | M | A call's row is drawn only once its arguments are complete or execution started — never a growing `Running… · 0s`. The previous row stays until then. |
| R5 | M | While the turn is open, the activity area keeps a fixed height (gap + row + command line, raised for tall rows) so nothing below it jumps; the reservation is dropped at settle. |
| R6 | M | Two calls executing at once (parallel tool calls) still show one row, chosen deterministically, not by render order. |
| R7 | M | Elapsed seconds only move forward: a component Pi recreates mid-call must not restart the clock. |
| R8 | M | A finished row stays on screen until the next call takes the line over. The line is never blank between consecutive calls. |
| R9 | S | `ctrl+o` on a row expands to Pi's own renderer for that call, unchanged; pressing it again collapses. |

### Groups

| # | P | Requirement |
| --- | --- | --- |
| R10 | M | Consecutive shell commands (`bash` / `powershell`) with nothing between them are one group: a header `Running <N> commands · <Ns>` plus one `└ <mark> $ <command> <duration>` line per command, in the order they ran. There is no collapsed one-liner state. |
| R11 | M | Output belongs to the call, not the group: it is drawn under a command only while that command runs, and it is hidden the moment that command finishes. Nothing is ever nested under a finished command line. |
| R12 | M | `✓` ok, `✗` failed, `…` in a command line still running, `✗ blocked` / `✗ denied` for our own gates. Newest eight commands; older ones collapse to `└ ... (<N> earlier calls)`. |
| R13 | M | A single command is not grouped: it keeps its own row (`Running 1 command · <Ns> <status>`) with a plain `└ <mark> $ <command>` second line. |
| R14 | M | Clicking one `└` command line renders that one call exactly as `full` renders it — Pi's own block, full command, full output — in place of the line; clicking again returns to the list. The other commands keep their list lines. |
| R15 | M | `ctrl+o` on a group row opens the whole group: every command as Pi's own block, in order, and the row hint flips to `ctrl+o to collapse`. Pressing again returns to the list. |
| R16 | M | Rows for `read` / `edit` / `ls` and other non-shell tools group by proximity: `✓ Reading 3 files (<latest path>) · <Ns>`, `✓ Editing 1 file (<path>) +5 -3 · <Ns>`. |
| R17 | M | `write` is never collapsed. In `compact` it keeps Pi's own block — header and full file content — never joins or contributes to a group row, and ends the current group so the next call starts a new one. |
| R18 | M | The `ctrl+o to expand` hint appears only on rows that hold a file body or more than one call. A single command row carries no hint. |

### Thinking and queued input

| # | P | Requirement |
| --- | --- | --- |
| R19 | M | Thinking is a line of its own — `~ Thought for <Ns> — click to read` — with no status glyph and no `└`. It is never part of a group, never counted with the commands, and it ends the group above it. The text appears on a click (D5), wrapped to the width; clicking again hides it. An in-flight thought reads `~ Thinking… — click to read`. A turn with no tool calls draws nothing. |
| R20 | M | A user message that arrives mid-turn (queued `Steering:` / `Follow-up:`) is drawn exactly as Pi draws it, is never folded into a row or a count, and ends the group above it. No group ever spans a message, and a row's expansion covers only the calls on its own side of it. |

### Views

| # | P | Requirement |
| --- | --- | --- |
| R21 | M | The view has exactly two values: `compact` (rows) and `full` (stock Pi output, nothing added). No third state, no "all rows" variant, and `full` engages no part of the renderer. |
| R22 | M | `full` draws exactly what Pi draws today, thinking included: Pi's own thinking block, its `Thinking...` hidden label (honouring `hideThinkingBlock` and `setHiddenThinkingLabel`) and Pi's own click on it all stay untouched. |
| R23 | M | No summary line, no band, no footer and no "done" line in either view. When the turn ends, nothing new is drawn — the last row just stays. |

### Security integration (the part that is ours, not the references')

| # | P | Requirement |
| --- | --- | --- |
| R24 | M | A blocked / denied / asked / errored call is labelled as such on its row (`✗ blocked`, `✗ denied`, per `C3`), the count reflects the attempt (`✗ blocked Reading 1 file (id_rsa)`), and the audit log records the same decision it records today. |
| R25 | M | The rendering never changes the model-facing prompt: schemas, descriptions, `promptSnippet` and `execute` stay stock. |

### Nested calls

| # | P | Requirement |
| --- | --- | --- |
| R26 | S | Calls a tool makes while running (`parentToolCallId`, e.g. a `codemode` script) are listed under that row with `…`/`✓`/`✗`/`⊘`, arg preview and duration; newest N, older ones behind `... (<N> earlier calls)`. |
| R27 | S | Nested calls never appear as transcript rows of their own and never inflate a row's count — the script's work counts as one call. |
| R28 | M | MCP and extension tools that we do not own keep their own renderer and their own row — they are not counted into a row we draw. |

### Settings, commands, diagnostics

| # | P | Requirement |
| --- | --- | --- |
| R29 | M | Settings live in one place, are validated on read (bad/missing file → defaults, never a crash) and are written best-effort: a failed write must not change in-memory state. |
| R30 | S | `/tool-view` opens a TUI settings menu (same list widget Pi's `/settings` uses); `/tool-view compact` and `/tool-view full` are the shortcuts. Non-TUI modes get a notice, not a menu. |
| R31 | S | `PI_<X>_DEBUG=/path` opt-in tracing of row decisions and timers, never throwing into the render path. |

---

## 6. Decisions

### Closed (carried from the view doc)

| # | Decision | Keeping it honest |
| --- | --- | --- |
| D1 | Row model: one row per proximity group, not one row per turn. History stays on screen. | `R10`–`R18` |
| D2 | Default view: `full` in the first release — existing users see no change. `compact` is discoverable through the README. | `R21`, `C5` |
| D3 | No `○` summary band, ever — not even as an opt-in. `compact` is rows only. | `R23` |
| D4 | `write` passthrough is fixed, not a setting: `write` always keeps Pi's block. | `R17` |
| D5 | Per-line opening is a click (thinking text, one command); `ctrl+o` keeps Pi's meaning and opens the whole group. | `R14`, `R15`, `R19` |
| D6 | Command name is `/tool-view`. | `R30` |
| D7 | Thinking is its own line, never a group member; group output is hidden once the command finishes. | `R19`, `R11` |

### Still open — close these, then write the ADR

**D8 → mechanism.** How do we get control of the row?

| Option | Buys | Costs |
| --- | --- | --- |
| **A. `pi.registerToolRenderer`** (minimal-toolcall) | public API, low version risk, no prototype surgery, composes with other extensions | cannot hide other rows, cannot reserve vertical space, cannot own a click or a group header |
| **B. Patch `ToolExecutionComponent.prototype`** (cc-tools) | true single-line activity area, fixed height, click, group header | reads internals (`argsComplete`, `executionStarted`, `hideComponent`, `expanded`, `result.durationMs`, `ui`, `cwd`), patches `addChild`, breaks when Pi renames anything |
| **C. Hybrid** | A for per-tool cosmetics, B only for slot/handover if a spike proves A cannot do it | two mechanisms to maintain |

**Recommendation:** A first; revisit B only if `R5`/`R6`/`R9`/`R15` cannot be met. Note that
`R15` and `R14` both need a mouse region per line, which A alone does not give — the spike
should answer that before anything else.

**Decision:** _TBD_

**D9 → entrypoint.** New `extensions/tool-view.ts`, listed in `package.json` →
`pi.extensions` (a fifth extension), **or** folded into `extensions/guard.ts` (no manifest
change, but a security entrypoint now also owns UI).
**Recommendation:** separate `extensions/tool-view.ts` + `src/tool-view/`, so the security
layers stay readable and the feature can be dropped by removing one manifest line.
**Decision:** _TBD_

**D10 → where do the settings live?**

| Option | Notes |
| --- | --- |
| new `~/.pi/agent/tool-view.json` | mirrors cc-tools; separate from the security policy |
| inside `sandbox.json` | one file for users, but mixes display with policy, and policy is a trust boundary (ADR-013/016) |
| `pi` settings / `settings.json` | not ours to own |

**Recommendation:** the separate file, through a small loader in `src/core/rows/settings.ts`
(validated, defaults on any error) — display must never be able to influence policy loading.
**Decision:** _TBD_

**D11 → do we write anything to the session?** cc-tools appends a `cc-tools-summary` custom
entry. We no longer draw a summary, and group counts can be derived from the calls in the group.
**Recommendation:** zero writes.
**Decision:** _TBD_

**D12 → which tools get labels, and what are the verbs?** Format is settled
(`<Verb-ing> <count> <noun>`); the table is not. Draft: `bash/powershell` Running ·
`read` Reading · `edit` Editing · `write` (not collapsed) · `ls` Listing · `grep` Searching ·
`find` Finding · `codemode` Running codemode. The table lives in one file (`tool-display.ts`),
not in per-renderer strings.
**Decision:** _TBD (final table goes in the ADR)_

**D13 → animation.** Pulse the `●` (cc-tools' OKLCH lightness loop) or keep it static and let
Pi's own indicator animate? **Recommendation:** static in v1 — one fewer timer, no
reduced-motion question.
**Decision:** _TBD_

**D14 → minimum Pi version.** Which Pi release carries the pieces we settle on in D8
(`registerToolRenderer`, `ctx.ui.setToolsExpanded`, mouse regions)? **Recommendation:** pin the
floor we actually use in `peerDependencies` and state it in the README.
**Decision:** _TBD_

---

## 7. What we take from the references

Reusable, worth copying:

- `Symbol.for()`-keyed state object on the prototype + a per-evaluation `LOAD_TOKEN` symbol
  to tell `/reload` from a double install, with stale wrappers disabled and stale closures
  swapped (cc-tools `installPatch`).
- Clock-pure animation: a value computed from `Date.now()` alone, so a skipped frame, a
  repaint or a `/reload` cannot desync it (cc-tools `pulseAmount`).
- `rowReady` / `slotOwner` / `successorRow`: hand the row over only when the next call can
  draw, and let a finished row yield the instant a newer sibling exists.
- Group counts re-derived from the calls in the group, so replay needs no persistence.
- `healRuns`: rebuild the run map from `sessionManager.getBranch()` when a frame renders
  with an empty map (the `/reload` window).
- Subagent/nested session ownership: only `ctx.mode === "tui"` may own shared state; a
  subagent's `session_start` must not reset the rows on screen.
- Every lifecycle handler body wrapped in try/catch (§8 of cc-tools' AGENTS.md: a throwing
  hook leaves rows permanently hidden).
- minimal-toolcall's `normalizeConfig(unknown)` — hand-written coercion with a fallback per
  field, no schema library, fingerprint-cached, cloned on every return.
- minimal-toolcall's jiti-free approach is not available to us; we keep `ts-loader.mjs`.

Do not copy:

- Patching the parent container's `addChild` (cc-tools) — highest-brittleness change in either
  repo.
- Two config systems in one package (cc-tools' file + in-memory patch state mutated by commands).
- The summary band (cc-tools) — dropped on purpose (`D3`).
- `skipLibCheck`-style typing shortcuts; this repo typechecks strict with `types: []`.

---

## 8. Testing plan (fits the existing harness)

| Layer | File | Covers |
| --- | --- | --- |
| unit — pure | `security/tests/unit/rows-labels.mjs` | verb/count/noun per tool, target = most recent, relative paths, `~`, `programOf()` (`cd x && rg` → `rg`), arg truncation, the `ctrl+o to expand` hint rule |
| unit — pure | `security/tests/unit/rows-groups.mjs` | group formation, header counts and plural, output shown only for the running command, output dropped on finish, newest-eight window, single-command shape, `write` ending the group |
| unit — state | `security/tests/unit/rows-state.mjs` | dedupe, settle idempotency, replay from a branch, row handover |
| unit — state | `security/tests/unit/rows-splitters.mjs` | thinking ends the group and is never counted; a queued `Steering:` / `Follow-up:` message ends the group; visible text ends the group |
| contract | `security/tests/contract/rows-wiring.mjs` | stub `ExtensionAPI`: which handlers register, `/tool-view compact\|full`, settings persistence via a scratch agent dir, non-TUI refusal, `full` engaging nothing |
| contract | `security/tests/contract/rows-security.mjs` | a blocked/denied call keeps its `✗` + word and its attempt count; guard decisions unchanged with rows on |

Rules that carry over: one process per file (prototype/patch state is process-wide), a scratch
`PI_CODING_AGENT_DIR` so a test never writes the developer's real settings, and no test may
require a terminal or a model.

---

## 9. Next steps

1. Close D8 (mechanism) and D9 (entrypoint) — they decide everything else.
2. Spike, timeboxed: 60 lines that draw `R1`/`R3`/`R4` for `bash` + `read`, and answer the one
   question the view depends on: can a per-line click be had without patching Pi? If not,
   reopen D8.
3. Write `adr/048-tool-view.md` with the accepted decisions and the final label table.
4. Implement `src/core/rows/` (pure) → tests → `src/tool-view/` wiring → entrypoint.
5. README section + a `skills/auto-permission-system/SKILL.md` note (display only, never a
   reason to relax a policy), and a line in the docs map in `CLAUDE.md`.

---

## 10. Delivered (v1)

Mechanism: `pi.registerToolRenderer` (`D8` option A). The extension is
`extensions/tool-view.ts` — wired in `package.json` → `pi.extensions`, independent of
`extensions/guard.ts`, `extensions/sandbox.ts` and `extensions/permission-mode.ts`. Nothing in
the security layers imports it, and it imports nothing from them.

| Area | Where |
| --- | --- |
| which tools we draw, and their command argument | `src/core/tool-view/labels.ts`, `src/core/tool-view/arguments.ts` (pure: no `pi`, no `tui`) |
| command groups: header text, marks, durations, newest-eight window | `src/core/tool-view/command-group.ts` |
| command groups: the live group, its ticker and repaints | `src/tool-view/command-groups.ts` |
| settings read/write, validation | `src/core/tool-view/settings.ts` |
| renderer, component, the `/tool-view` switch | `src/tool-view/` |
| entrypoint | `extensions/tool-view.ts` |
| tests | `security/tests/unit/tool-view-*.mjs`, `security/tests/contract/tool-view-*.mjs` |

**Scope after ADR-050:** `compact` compacts shell commands only. `read`, `edit`, `write`, `ls`,
`grep`, `find`, `codemode` and every MCP or extension tool keep Pi's own renderer and Pi's own
frame in both views — the resolver hands them straight back — so their styling cannot drift from
Pi's. Every requirement below that describes a file row (`R1`, `R2`, `R16`) therefore describes the
dropped v1 rows, not the shipped view.

Shipped for shell commands: `R3`, `R4`, `R10`, `R12`, `R13`, `R15`, `R17` (a `write` still ends a
group), `R21`–`R25`, `R28`–`R30`. Three behaviours are worth naming: consecutive shell calls share
one `Running <N> commands` row with a `└` line per command (ADR-050), `ctrl+o` and a click hand the
calls back to Pi's own renderers untouched and open every command of the group, and a call whose
arguments are still streaming is left to Pi rather than drawn as `Running … · 0s` (`R4`).

Not delivered, and why:

| Gap | Requirement | Why |
| --- | --- | --- |
| Compacting file and search tools into rows | `R1`, `R2`, `R16`, `R18` | Out of scope after ADR-050: those tools keep Pi's block so their styling stays Pi's |
| Output drawn under the one command that is still running | `R11` | A row never draws a tool's output; the running command's block is one `ctrl+o` away |
| Clicking one `└` line to open that command alone | `R14` | A group line has no mouse region of its own; `ctrl+o` opens every command in the group (`R15`) |
| `~ Thought for Ns — click to read` | `R19` | Thinking stays Pi's own block in both views; the renderer never touches it |
| A queued message breaking a group | `R20` | A user message closes the group, so no group spans one by construction |
| Nested `codemode` calls listed under the row | `R26`, `R27` | `codemode` keeps Pi's block; its inner calls are Pi's to draw |
| `PI_<X>_DEBUG` tracing | `R31` | Not started |

Known limits of the v1 renderer: a shell group is drawn by its first call's component, so the frames
in `TOOL_ROWS_VIEWS.md` that click a single `└` line describe the target rather than v1.

Groups are built from render order, not from the session: a component is created for each call in
the order Pi runs them, so consecutive shell calls join the open group, and any other tool call, a
new turn or a new user message closes it (ADR-050).
