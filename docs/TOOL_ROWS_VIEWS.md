# Tool rows — examples

Simple version. Two views, one switch:

| View | What you see |
| --- | --- |
| `full` | today's Pi output. Nothing changes, nothing is added. This is the "off" state. |
| `compact` | tool calls squeezed into rows. Nothing else is added. |

Frames below assume a 100-column terminal. `<…>` = the real output, which is not shown to keep
the example short.

One row reads:

```text
<gutter><Verb-ing> <count> <noun> (<target>) · <duration> <status> ctrl+o to expand
```

The verb never flips when the call finishes — the line just stops ticking and gains `✓`.

---

## 1. Same 6 tool calls, both views

### `full` (today — nothing added)

```text
read
  src/config.ts
──────────────────────────────────────────
<file contents>

read
  src/loader.ts
──────────────────────────────────────────
<file contents>

bash
  npm test
──────────────────────────────────────────
<test output, exit 1>

read
  src/settings.ts
──────────────────────────────────────────
<file contents>

bash
  git status
──────────────────────────────────────────
<status output>

edit
  src/settings.ts
──────────────────────────────────────────
Successfully replaced 1 block
```

### `compact`

```text
 Reading 2 files (src/loader.ts) · 3s ✓ ctrl+o to expand

 Running 1 command · 12s ✗
   └ $ npm test

 Reading 1 file (src/settings.ts) · 1s ✓ ctrl+o to expand

 Running 1 command · 1s ✓
   └ $ git status

 Editing 1 file (src/settings.ts) +5 -3 · 2s ✓ ctrl+o to expand
```

That is the whole feature: 6 blocks → 5 rows (the two reads in a row share one), same
information, `ctrl+o` when you need a body. Nothing extra is drawn when the turn ends — the last
row just stays there.

---

## 2. What happens while it runs (`compact`)

Two moments of one `bash` call:

```text
 ● Running 1 command · 1s
   └ $ npm view hunk version
```
```text
 Running 1 command · 4s ✓
   └ $ npm view hunk version
```

- Column 1 is the gutter: `●` = still running, with the seconds ticking.
- `✓` = finished, seconds frozen. It stays until the next call replaces it — never a blank gap.
- Thinking is its own one-line row (`~ Thought for 4s — click to read`). It is not part of a
  group, not counted with the commands, and it ends the group above it (§5).
- When the whole turn ends, nothing new appears: the last row stays as it is. No "done" line,
  no summary line.

---

## 3. Small cases

| Case | `full` | `compact` |
| --- | --- | --- |
| one read | full block with file body | ` Reading 1 file (src/a.ts) · 1s ✓ ctrl+o to expand` |
| 3 reads in a row | 3 blocks | ` Reading 3 files (src/c.ts) · 4s ✓ ctrl+o to expand` |
| read + bash | 2 blocks | ` Reading 1 file & Running 1 command · 3s ✓` |
| bash fails | block with error text | ` Running 1 command · 12s ✗` + `└ $ npm test` |
| read blocked by policy | block with "blocked by policy" | ` Reading 1 file (id_rsa) ✗ blocked` |
| user denies the ask | block with "denied by user" | ` Running 1 command ✗ denied` + `└ $ curl https://x` |
| edit a file | block with the diff | ` Editing 1 file (src/a.ts) +5 -3 · 2s ✓ ctrl+o to expand` |
| write a file | block with full content | **same as `full`** — a write is never collapsed (below) |
| codemode, 2 inner calls | 1 block with script + call log | ` Running codemode · 3s ✓` + 2 `└` lines (below) |
| 3 shell commands in a row | 3 blocks | ` Running 3 commands · 5s ✓` + 3 `└` lines (below) |
| thinking between commands | block, then block | own line `~ Thought for 4s — click to read`; the groups either side stay separate (§5) |
| thinking, no tools | thinking block, then answer | nothing new is drawn |
| ask is open | ask prompt | ` ● Waiting on your answer · 2s` (one line only) |
| long command, 40 cols | Pi wraps it | ` ● Running 1 command · 4s` + truncated `└ $ rg -n "toolTitle…` |

### codemode with inner calls (`compact`)

```text
 Running codemode · 3s ✓
   └ await tools.searchTools("rank")
   └ ✓ mcp:dev-radius:search rank 120ms
   └ ✓ read src/config.ts 8ms
```

Inner calls never become rows of their own, and they are not counted separately: the turn
reports `used codemode ×1`.

### Shell commands one by one (`compact`)

Several `bash` calls with nothing between them are one group. Every command keeps its own
`└ $ cmd` line in the order it ran — no collapsed one-liner you have to open first, and no
output under a finished command:

```text
 ● Running 2 commands · 5s
   └ ✓ $ npm test 1.2s
   └ … $ npm run build
      > tsc -p tsconfig.json
```

When they finish, the output goes away and only the command lines stay:

```text
 Running 2 commands · 5s ✓
   └ ✓ $ npm test 1.2s
   └ ✓ $ npm run build 3.0s
```

Output is shown only under the command that is **still running**. The moment a command finishes
its output is collapsed away — the group never grows a nesting of output lines under old
commands. Click that command line (or `ctrl+o` the group) to read the output again.

**Two ways to open a group.** `ctrl+o` on the group row opens the **whole group** — every
command as Pi's own block, in the order it ran, full output, and the hint flips to
`ctrl+o to collapse`:

```text
 Running 2 commands · 5s ✓ ctrl+o to collapse

bash
  npm test
──────────────────────────────────────────
✓ tests/rows-summary.mjs (12)
✓ tests/rows-labels.mjs (9)
✓ tests/rows-state.mjs (7)
42 passing (1.2s)

bash
  npm run build
──────────────────────────────────────────
> tsc -p tsconfig.json

dist/index.js    12.4 kB
dist/index.d.ts   1.2 kB
```

Clicking one `└` command line opens **only that command** — Pi's block for it, and the other
lines stay as rows:

```text
 Running 2 commands · 5s ✓
   └ ✓ $ npm test 1.2s

bash
  npm run build
──────────────────────────────────────────
> tsc -p tsconfig.json

dist/index.js    12.4 kB
dist/index.d.ts   1.2 kB
```

The other commands stay in the list; only the one you clicked switches to Pi's block. Click it
again to put that line back. A later call takes the row over and the finished group keeps this
list where it is.

- Each line is `<status> $ <command> <duration>`, cut with `…` at the terminal width; clicking
  the line swaps it for Pi's full block for that call.
- Output belongs to the call, not to the group: it is drawn under a command only while that
  command runs, and hidden once it finishes. Nothing is nested under a finished command line.
- `✓` ok, `✗` failed, `…` still running, `✗ blocked` / `✗ denied` for our own gates.
- Newest 8 commands; older ones become `└ ... (2 earlier calls)`.
- One command on its own is not grouped: it keeps a single row with a plain second line.

```text
 Running 1 command · 4s ✓
   └ $ npm view hunk version
```

### `write` is never collapsed (`compact`)

A file being written is something you should see without asking, so `write` keeps Pi's full
block — its own header, its own content — even in `compact`. It does not join a group row and it
ends the current group: rows above stay, the next call starts a new one.

```text
 Reading 1 file (src/a.ts) · 1s ✓ ctrl+o to expand

write
  README.md
────────────────────────────────────────
# auto-permission-system

…full file content, exactly as in `full` view…

 Running 1 command · 1s ✓
   └ $ git status
```

`edit` is still collapsed (it already shows `+5 -3`); only `write` opts out, because the whole
file content is the thing you want to see.

---

## 4. `ctrl+o` — expand one row

```text
before:   Reading 2 files (src/b.ts) · 3s ✓ ctrl+o to expand

after:    read
            src/a.ts
          ──────────────────────────
          <file contents>

          read
            src/b.ts
          ──────────────────────────
          <file contents>
```

`ctrl+o` gives you `full` for that one row. Press again to collapse.

For a shell group the same keys expand the whole group: every command in it, as Pi's blocks.
Clicking a single `└` line inside the group opens only that command (§3.5).

---

## 5. Text and thinking between calls (`compact`)

### Visible text splits the group

```text
 Reading 2 files (src/b.ts) · 3s ✓ ctrl+o to expand

Here is what I found. The config lives in two files…

 Running 1 command · 1s ✓
   └ $ ls
```

A row sits where its calls ran — it never slides below the text that came after it.

### Thinking is its own row, not part of the group

A thought is one line of its own, drawn where the thinking ran. It never joins a group, it is
never counted with the commands, and it ends the group above it — commands before and after it
are two groups:

Input → thinking → command → thinking → command gives one line per thought and one group per
command:

```text
 Running 1 command · 6s ✓
   └ ✓ $ npm test 1.2s

~ Thought for 4s — click to read

 ● Running 1 command · 3s
   └ … $ npm run build
      > tsc -p tsconfig.json
```

**Click the `~ Thought for 4s` line:** the actual thinking appears under it and the label flips
to `click to hide`:

```text
 Running 1 command · 6s ✓
   └ ✓ $ npm test 1.2s

~ Thought for 4s — click to hide
Run the suite first. If it is green, build — dist/ is generated
output, so never edit those files by hand.

 ● Running 1 command · 3s
   └ … $ npm run build
      > tsc -p tsconfig.json
```

- `~ Thought for Ns` is one line with no status glyph (`●`/`✓` are for calls, not thoughts) and no
  `└`, because it belongs to no group.
- Clicking the line shows the thinking text under it, wrapped to the terminal width; click again
  to hide it.
- Thinking is never counted as a command: the row says `Running 1 command`, not 2 items.
- A thought still being generated shows `~ Thinking… — click to read`. A thought in a turn with
  no tool calls at all has no rows around it, so nothing new is drawn.

### A queued message breaks the group

A message that arrives while the agent is still working is never folded into a row and never
grouped across. Pi draws it as it always does — the dim `Steering:` / `Follow-up:` lines in the
pending area, then a normal user message in the transcript when it lands. The rows stop at that
point and start again after it:

While it is still queued, the running row stays above it, untouched:

```text
 ● Running 1 command · 3s
   └ … $ npm run build
      > tsc -p tsconfig.json

Steering: stop after this build, run the linter next
↳ alt+up to edit all queued messages
```

When it lands mid-turn, the group above ends and the next command opens a new one — never
`Running 2 commands`:

```text
 Running 1 command · 6s ✓
   └ ✓ $ npm run build 3.0s

stop after this build, run the linter next

 ● Running 1 command · 2s
   └ … $ npm test
```

- No row is opened, extended or counted for the message: it is input, not a tool call.
- Nothing is carried across it — a group never spans a message, and `ctrl+o` on a row expands
  only the calls on its own side of the message.
- A `Follow-up:` message waits for the turn to end, so it changes nothing inside the current
  group; the next turn starts its own rows.
- `compact` never rewrites the message text: whatever Pi shows is what you see.

### In `full`, thinking is Pi's own block
`compact` only renames what Pi already draws. `full` adds nothing — thinking there is exactly
what Pi's own setting makes it, and Pi's settings keep working:

With thinking shown (Pi's default, `hideThinkingBlock: false`), the thought is Pi's italic
thinking text, with no label and no row of ours:

```text
Run the suite first. If it is green, build — dist/ is
generated output, so never edit those files by hand.

bash
  npm test
──────────────────────────────────────────
<test output>
```

With thinking hidden (`hideThinkingBlock: true`), Pi draws its one-line label instead:

```text
Thinking...

bash
  npm test
──────────────────────────────────────────
<test output>
```

- `Thinking...` is Pi's label (`setHiddenThinkingLabel` can change it); clicking it reveals the
  text — Pi's own click, unchanged by `compact`.
- `compact` maps both cases to the same row, `~ Thought for 4s — click to read`, and clicking it
  shows the same text Pi would show. The `4s` is ours; Pi's label carries no duration.
- Neither view invents a thinking block, a glyph or a count: whatever Pi's setting says is what
  `full` shows.

---

## 6. Rules, short

1. Column 1 is the gutter: `●` while the call runs, a space once it has finished.
2. A row reads `<Verb-ing> <count> <noun> (<target>) · <duration> <status>`. The verb never
   flips when the call finishes — the line stops ticking and gains `✓`.
3. `✓` done, `✗` failed, `✗ blocked` / `✗ denied` for our own gates. A blocked or denied call
   says so on the row — never silent.
4. A finished row stays on screen until the next call takes the line over.
5. Rows holding a file body or more than one call end with `ctrl+o to expand`; a single command
   row does not, because its `└ $ cmd` line already shows what ran.
6. Several shell commands in a row are one group of `└ $ cmd` lines, with `✓`/`✗` and how long
   each took. Output shows only under the command still running; when it finishes its output is
   hidden — click the line or `ctrl+o` to read it. No collapsed one-liner to open first.
7. Thinking is a line of its own (`~ Thought for 4s — click to read`), not part of a group: it
   is not counted with the commands and it ends the group above it. Clicking the line shows the
   thinking text.
8. A message arriving mid-turn (queued `Steering:` / `Follow-up:`) is never grouped: it ends the
   group above it, starts nothing of its own, and is drawn exactly as Pi draws it.
9. `write` is never collapsed: Pi's full block, content and all, even in `compact`.
10. Visible text splits a group; a row never slides below text that came after it.
11. `ctrl+o` on any row = Pi's real output for that call.
12. No summary line, no footer, no "done" line. Nothing is drawn when the turn ends.
13. `full` must look exactly like Pi does today. No rows, no timers, no relabelled thinking —
    Pi's thinking block, its `Thinking...` label and its own clicks stay as they are.
14. Wide or narrow terminal, the row is cut with `…` instead of wrapping.
15. Clicking a command line swaps it for Pi's `full`-mode block for that call; click again to go
    back to the list. `ctrl+o` on the group row opens every command in it at once.

---

## 7. Commands

- `/tool-view compact` — turn rows on
- `/tool-view full` — turn them off (back to today)
- `/tool-view` — menu with the same choices

Default for the first release: `full` (nothing changes for existing users), `compact` once the
README tells people about it.

---

Requirements and open decisions: [`TOOL_ROWS_REQUIREMENTS.md`](./TOOL_ROWS_REQUIREMENTS.md).
