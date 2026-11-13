# Tool rows

**Status:** the collapsed row is shipped for shell commands, reads and `codemode`. Shipped: the mark
in column 1, a `  └` line per command with its own mark, the fold to one line once a later call
starts, the `(last command)` target, `blocked` / `denied` on the row, the `(thinking Ns)` bracket on
the live row, a 70 %-wide command column, one timer per row at the end of the header text and none
on a `└` line, the group's `└` lines as the first click level (§4), `Reading N files` rows for `read`
with one `  └ <path>` line per file (§3), and Pi's own block on expand — `compact` wraps Pi's own
components in Pi's own frame and never redraws them. In `compact` Pi's hidden-thinking label is
blanked, so a hidden thought takes no line and no gap; while one streams the row carries the
`(thinking Ns)` bracket and keeps counting. The header is drawn once at the first call and each
later call draws its own `└` line in its own slot, so even a thought Pi renders visibly cannot push a
command line above it (§5). Compact children stay command-only.
Not shipped: rows for `edit` (§1, §3), a click on a single `codemode` inner call, and per-`└`-line
clicks (§4).

## Commands

- `/tool-view compact` — turn rows on
- `/tool-view full` — turn them off (back to today)
- `/tool-view` — menu with the same choices

Default for the first release: `full` (nothing changes for existing users), `compact` once the
README tells people about it.

Simple version. Two views, one switch:

| View | What you see |
| --- | --- |
| `full` | today's Pi output. Nothing changes, nothing is added. This is the "off" state. |
| `compact` | tool calls squeezed into rows. Nothing else is added. |

Frames below assume a 100-column terminal. `<…>` = the real output, which is not shown to keep
the example short.

One row reads:

```text
<gutter><Verb-ing> <count> <noun> (<target>) [blocked|denied] ctrl+o to expand  <duration>
```

The verb never flips when the call finishes: the gutter dot turns into `✓` in place, the
seconds freeze, and nothing else on the line moves.

Finished work then tightens twice, on its own:

| Level | When | What you see |
| --- | --- | --- |
| running | the command is running | its row, with Pi's own output drawn under the line |
| grouped | that command finished, its group is still the newest row | one `└ ✓ $ cmd` line per command, output gone |
| one line | a later call started | the whole group as a single row, `└` lines gone |

The newest group always keeps its `└` lines. Everything above it has already become one line, so
the transcript reads as one line per finished group and the live group only opened up.

Thinking rides on the row while it streams — `● Running 1 command (thinking 4s) · 1s` — and the
bracket leaves when the thought completes. The thought itself takes no space in `compact`: Pi's
hidden-thinking label is blanked, so its run is skipped whole (§5). The label comes back in `full`.

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
✓ Reading 2 files (src/loader.ts) ctrl+o to expand · 3s

✗ Running 1 command (npm test) ctrl+o to expand · 12s

✓ Reading 1 file (src/settings.ts) ctrl+o to expand · 1s

✓ Running 1 command (git status) ctrl+o to expand · 1s

✓ Editing 1 file (src/settings.ts) +5 -3 ctrl+o to expand · 2s
```

That is the whole feature: 6 blocks → 5 rows, same information, `ctrl+o` when you need a body.
Only the newest row still has anything open — every group above it was folded to one line by the
call that came after it. Nothing extra is drawn when the turn ends — the last row just stays
there.

### `compact`, when the commands come in a run

Commands that follow each other with nothing in between share one row, and every command keeps
its own `└` line:

```text
✓ Reading 1 file (src/settings.ts) ctrl+o to expand · 1s

✓ Running 3 commands · 4s
  └ ✓ $ npm run typecheck
  └ ✗ $ npm test
  └ ✓ $ git status
```

- Same row shape as above, `3 commands` instead of `1 command`, one line per command in the
  order it ran. The lines are open because this is the newest row on screen.
- `✓` / `✗` per line, with no time of its own: the header keeps the only timer. The row's own mark
  is the mark of the command that ran last: this run ends `✓`, `✗`, `✓`, so the row reads `✓` and the
  failure keeps its own `└ ✗` line.
- No output under a finished command: it is drawn only under the command still running and
  hidden the moment that one ends (§3). The frozen lines are the whole record.
- The next call folds the whole list to `✓ Running 3 commands (git status) ctrl+o to expand · 4s`
  (below). `ctrl+o` on the row opens every command as Pi's own block; clicking a single `└` line
  opens just that one.

### `compact`, once a later call starts: one line per group

The next tool call is the signal: the group above it stops showing its `└` lines and becomes a
single row. Nothing on the row itself moves — only the lines go away.

```text
✓ Reading 1 file (src/settings.ts) ctrl+o to expand · 1s

✓ Running 3 commands (git status) ctrl+o to expand · 4s

✓ Editing 1 file (src/settings.ts) +5 -3 ctrl+o to expand · 2s
```

- The fold is automatic, not a setting: it happens when the group stops being the newest row.
  The newest group keeps its `└` lines until that moment.
- Clicking the row unfolds it again, and it stays unfolded until a newer call takes the row over;
  clicking a second time folds it back.
- `<target>` names one command, not all three — the same one the row's mark came from, the last
  one to run. `Running 3 commands` keeps the count honest — never `Running 1 command` because
  one name fits.
- The name is the last command's **last segment**: a `cd … && sed … && echo …` chain collapses to
  its final stage, whitespace collapses to one line, and a quoted `&&` / `|` is not a boundary.
- The row is composed against the terminal width: the target absorbs whatever columns are left
  after the mark, count, duration and `ctrl+o` hint, is cut **from the left** at a token (or
  path-segment) boundary, and is dropped outright when no useful tail fits. The count, hint and
  duration are never truncated.

```text
100 cols  ✓ Running 4 commands (sed -n 660,700p plan/tool-rows-views.md) ctrl+o to expand · 8s
 80 cols  ✓ Running 4 commands (… 660,700p plan/tool-rows-views.md) ctrl+o to expand · 8s
 60 cols  ✓ Running 4 commands ctrl+o to expand · 8s
```
- The mark and the name both come from the last command, so the folded row is the list's own
  last line, not a summary of it; unfold to see that `npm test` failed.
- `ctrl+o` opens every command as Pi's own block, folded or not.
- Narrower than 40 columns the group comes folded, because the lines would be all `…`; widen
  again and they come back (§3, rule 15).
- A group of one command folds the same way: `✓ Running 1 command (npm view hunk version) · 4s
  ctrl+o to expand`.

### `compact`, a single shell call on one line

One shell call is one line — the command itself is the only child line, because that is the thing
you want to read:

```text
✓ Running 1 command · 4s
  └ $ npm view hunk version
```

A read draws its own file line instead:

```text
✓ Reading 1 file · 1s
  └ src/a.ts

✓ Editing 1 file (src/settings.ts) +5 -3 ctrl+o to expand · 2s

✗ Reading 1 file blocked · 1s
  └ ~/.ssh/id_rsa
```

- `1 file` / `1 command`, never `1 files` or `1 commands`.
- `ctrl+o to expand` only when there is a body behind the row (a file content, a diff, a
  group) and the row is folded; a blocked or denied call has nothing to open, so the hint is left
  off. An open row showing its `└` line carries no hint either.
- A read line has no `$` prompt, no mark and no duration when it is the run's only read: the path
  is the line. `blocked` / `denied` stays on the header for a single read and on the line inside a
  run (§3).
- Still running: `● Reading 1 file · 1s` — the `●` and the ticking seconds are the only difference;
  when it lands that same first column becomes `✓`.
- A single `bash` call adds a line, because the command itself is the thing
  you want to read:

```text
✓ Running 1 command · 4s
  └ $ npm view hunk version
```

  It is never grouped (`Running 1 commands` does not exist), carries no `ctrl+o to expand`
  hint while it is the newest row, and keeps its output while it runs (§2). Once a later call
  starts, the pair folds to `✓ Running 1 command (npm view hunk version) ctrl+o to expand · 4s`.

---

## 2. What happens while it runs (`compact`)

Three moments of one `bash` call, with a thought in the middle:

```text
● Running 1 command (thinking 1s) · 2s
  └ $ npm view hunk version
```
```text
● Running 1 command · 2s
  └ $ npm view hunk version
```
```text
✓ Running 1 command · 4s
  └ $ npm view hunk version
```

- Column 1 is the gutter: `●` = still running, with the seconds ticking.
- The dot becomes the mark in that same column — `✓` done, `✗` failed — as the seconds freeze.
  The mark is never moved to the end of the line, so the row never grows or shifts, and the
  finished row stays there until the next call takes the line over — never a blank gap.
- Thinking borrows the target slot while it streams: `(thinking 1s)` appears and ticks like
  everything else, then the moment the thought completes the bracket is dropped and the row is
  back to `● Running 1 command · 1s`. A thought never changes the count, and the row's timer keeps
  running while it streams, so a live row never looks frozen; the timer freezes only when the row
  settles. The thought itself is Pi's own block in Pi's own place, outside the row — the row never
  draws a line for it and ends where it starts (§5).
- The `└` line keeps the command, minus noise: `cd <cwd> && `, wrappers (`sudo`, `uv run`,
  `env A=1`) and the interpreter are dropped (`python3 -m pytest …` reads `pytest …`), and a
  pipeline or chain is kept whole — only the folded header names the last segment. The command
  may take up to 70 % of the width — then `program arg … tail`, then `program … tail`, then the
  program alone. A duration ends its own text instead of being pushed to the display's right
  edge, so a row stops where its text stops; the `ctrl+o to expand` hint sits just before the
  duration.
- The `└` line lives only while this is the newest row: one call later, the pair reads
  `✓ Running 1 command (npm view hunk version) ctrl+o to expand · 4s` (§1).
- When the whole turn ends, nothing new appears: the last row stays as it is. No "done" line,
  no summary line.

---

## 3. Small cases

| Case | `full` | `compact` |
| --- | --- | --- |
| one read | full block with file body | `✓ Reading 1 file · 1s` + `└ src/a.ts` |
| 3 reads in a row | 3 blocks | `✓ Reading 3 files · 4s` + 3 `└` lines (below) |
| 3 reads, folded | 3 blocks | `✓ Reading 3 files (src/c.ts) ctrl+o to expand · 4s` — click for the list |
| a sliced read | block with the slice | `✓ Reading 1 file · 1s` + `└ src/app.ts:120-179` |
| read + bash | 2 blocks | `✓ Reading 1 file & Running 1 command · 3s` |
| bash fails | block with error text | `✗ Running 1 command · 12s` + `└ $ npm test` |
| read blocked by policy | block with "blocked by policy" | `✗ Reading 1 file (id_rsa) blocked` · inside a run `└ ✗ id_rsa blocked` |
| user denies the ask | block with "denied by user" | `✗ Running 1 command denied` + `└ $ curl https://x` |
| edit a file | block with the diff | `✓ Editing 1 file (src/a.ts) +5 -3 ctrl+o to expand · 2s` |
| write a file | block with full content | **same as `full`** — a write is never collapsed (below) |
| codemode, 2 inner calls | 1 block with script + call log | `✓ Running codemode · 3s` + 2 `└` lines (below) |
| 3 shell commands in a row | 3 blocks | `✓ Running 3 commands · 5s` + 3 `└` lines (below) |
| 3 shell commands, folded | 3 blocks | `✓ Running 3 commands (git status) ctrl+o to expand · 4s` — click the row to unfold |
| 3 shell commands at once | 3 blocks | `● Running 3 commands · 1s` + 3 `…` lines (below) |
| thinking between commands | block, then block | nothing in `compact` (label blanked, zero height); `full` shows Pi's block (§5) |
| thinking, no tools | thinking block, then answer | nothing new is drawn |
| ask is open | ask prompt | `● Waiting on your answer · 2s` (one line only) |
| long command, 40 cols | Pi wraps it | `● Running 1 command · 4s` + truncated `└ $ rg -n "toolTitle…` |

### codemode with inner calls (`compact`)

A `codemode` call is its own row: the title is fixed (`codemode`, never a command count), the first
child line is the script's first statement, and every inner call the script makes gets one line with
its own mark. Only the header carries a time.

```text
● codemode · 1ms
  └ await tools.searchTools("rank")
  └ … mcp:dev-radius:search rank
  └ … read src/config.ts
```

When the script finishes, the header settles and the inner lines take their outcome:

```text
✓ codemode · 3s
  └ await tools.searchTools("rank")
  └ ✓ mcp:dev-radius:search rank
  └ ✓ read src/config.ts
```

- The inner calls come from `tool_execution_start` / `tool_execution_end` events carrying
  `parentToolCallId`, so each line is live: `…` while it runs, then `✓` or `✗`. Durations are not
  tracked per inner call — the `codemode` row's own timer covers the whole script.
- Inner calls are never rows of their own and never change the title: a codemode run reads
  `codemode`, not `Running 2 commands`.

### Shell commands one by one (`compact`)

Several `bash` calls with nothing between them are one group. Every command keeps its own
`└ $ cmd` line in the order it ran — no collapsed one-liner you have to open first, and no
output under a finished command:

```text
● Running 2 commands · 5s
  └ ✓ $ npm test
  └ … $ npm run build
     > tsc -p tsconfig.json
```

When they finish, the output goes away and only the command lines stay:

```text
✓ Running 2 commands · 5s
  └ ✓ $ npm test
  └ ✓ $ npm run build
```

Output is shown only under the command that is **still running**. The moment a command finishes
its output is collapsed away — the group never grows a nesting of output lines under old
commands. Click that command line (or `ctrl+o` the group) to read the output again.

That is the middle level. When the next call starts, the group above tightens once more and its
lines give way to one row — `✓ Running 2 commands (npm run build) ctrl+o to expand · 5s` — and
one click brings them back (§1). Only the newest group ever shows its lines.

**Two ways to open a group.** `ctrl+o` on the group row opens the **whole group** — every
command as Pi's own block, in the order it ran, collapsed first and full output on the next press
(§4):

```text
✓ Running 2 commands · 5s ctrl+o to collapse

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
✓ Running 2 commands · 5s
  └ ✓ $ npm test

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

- Each line is `<mark> $ <command> <duration>`, cut with `…` at the terminal width; clicking
  the line swaps it for Pi's full block for that call.
- Output belongs to the call, not to the group: it is drawn under a command only while that
  command runs, and hidden once it finishes. Nothing is nested under a finished command line.
- `✓` ok, `✗` failed, `…` still running. A command stopped by one of our gates carries the word
  after it: `└ ✗ $ cat ~/.ssh/id_rsa blocked`, `└ ✗ $ curl https://x denied`.
- Newest 8 commands; older ones become `└ ... (2 earlier calls)`.
- Clicking the group row folds the list to one line — `✓ Running 2 commands (npm run build) · 5s
  ctrl+o to expand` — and clicking it again brings the lines back (§1). The fold also happens on
  its own as soon as this group stops being the newest row.
- The row's mark is the last command's mark, the same one its line ends on; a failure earlier in
  the run keeps its own `└ ✗` line and does not turn the row `✗`.
- One command on its own is not a group: it is a single row plus its one `└ $ cmd` line, and it
  folds to `✓ Running 1 command (npm run build) ctrl+o to expand · 3s` when a later call starts.

```text
✓ Running 1 command · 4s
  └ $ npm view hunk version
```

### Several commands at once (`compact`)

One batch of `bash` calls that Pi runs together is still a single group, and every command in it
is running at the same moment — so every line carries `…` and draws its own output:

```text
● Running 3 commands · 1s
  └ … $ npm test
     > tsc -p tsconfig.json
  └ … $ npm run lint
  └ … $ git status
     On branch main
```

Each line settles on its own, with its own mark; the header keeps the only time. The group ends when
the last one does:

```text
✓ Running 3 commands · 4s
  └ ✓ $ npm test
  └ ✓ $ npm run lint
  └ ✓ $ git status
```

- The header duration is the group's own elapsed time, never the sum of the lines: three
  commands of 3.2s, 2.1s and 0.3s run together read `4s`, because that is how long you waited.
- The row's mark is the command that finished last, not the worst one: three commands settling
  `✓`, `✗`, `✓` read `✓`, and the failure keeps its own line.
- Output still lives under the running command only. Several running means several outputs, and
  one line going `✓` takes only its own output away.
- The whole batch folds to one line when the next call starts, exactly like the sequential group.
- Clicking a line or `ctrl+o` on the row behaves exactly as it does for the sequential group.

### `write` is never collapsed (`compact`)

A file being written is something you should see without asking, so `write` keeps Pi's full
block — its own header, its own content — even in `compact`. It does not join a group row and it
ends the current group: rows above stay, the next call starts a new one.

```text
✓ Reading 1 file (src/a.ts) ctrl+o to expand · 1s

write
  README.md
────────────────────────────────────────
# auto-permission-system

…full file content, exactly as in `full` view…

✓ Running 1 command · 1s
  └ $ git status
```

`edit` is still collapsed (it already shows `+5 -3`); only `write` opts out, because the whole
file content is the thing you want to see.

### A read run (`compact`)

Consecutive `read` calls are one group with the same three levels: the header, one `└` line per
file, then Pi's blocks.

```text
● Reading 3 files · 1s
  └ ✓ src/config.ts
  └ ✓ src/loader.ts
  └ … src/settings.ts
```

- No `$` prompt on a read line: the path is the line. A sliced read carries its range
  (`  └ ✓ src/app.ts:120-179`); a whole-file read carries none.
- A single read in the group draws no mark and no duration — `  └ src/a.ts` — because the header
  already carries both, exactly like a single command.
- A blocked or denied read keeps its word on its own line, after the path:
  `  └ ✗ ~/.ssh/id_rsa blocked`.
- Newest 8 lines; older calls become `  └ ... (2 earlier calls)`.
- The path column is the same 70 % as a command line, cut with `…` from the left at a path
  boundary so the file name survives.
- The header's target appears only once the row is folded, so the open row is the list and nothing
  else. When a later call starts it reads `✓ Reading 3 files (src/settings.ts) ctrl+o to expand · 4s`.
- A read run and a shell run never share a row: a `bash` call between reads starts a new group.

---

## 4. Four levels of detail

One group, one call, one ladder. Click or `ctrl+o` once and you drop a level; the same keys and
the same clicks bring you back.

| Level | What you see | Default when | How you get there |
| --- | --- | --- | --- |
| 1 | one line per group | a later call started | automatic, or click the group row |
| 2 | the group's `└` lines | it is the newest row | automatic, or click a folded row |
| 3 | Pi's block for one call, result collapsed | you opened it | click the row again, a `└` line, or `ctrl+o` |
| 4 | Pi's block for one call, full result | you opened it | `ctrl+o` again, or click the block |

The next frames walk the same group down and back. Nothing on the row itself ever changes:
the mark, the count, the target and the duration stay exactly where they were.

### Level 1 — one line

```text
✓ Running 3 commands (git status) ctrl+o to expand · 4s
```

### Level 2 — the group's lines

```text
✓ Running 3 commands · 4s
  └ ✓ $ npm run typecheck
  └ ✗ $ npm test
  └ ✓ $ git status
```

### Level 3 — Pi's block for one call, result collapsed

Click the `└ ✗ $ npm test 2.4s` line and only that call turns into Pi's own block; the other
lines stay as rows:

```text
✓ Running 3 commands · 4s
  └ ✓ $ npm run typecheck

bash
  npm test
──────────────────────────────────────────
✗ tests/rows-summary.mjs (7)
… 11 more lines · ctrl+o to expand

  └ ✓ $ git status
```

### Level 4 — the same block, fully expanded

`ctrl+o` on it, and Pi's own output is all there:

```text
bash
  npm test
──────────────────────────────────────────
✓ tests/rows-labels.mjs (9)
✓ tests/rows-state.mjs (7)
✗ tests/rows-summary.mjs (7)
…
41 passing, 1 failing (2.4s)
```

- 1 ↔ 2: click the group row. The count, mark, target and duration never change — only the
  `└` lines come and go.
- 2 ↔ 3: click one `└` line; that call alone becomes Pi's block, and the rest of the group is
  still a list. Click the block again to put the line back.
- 3 ↔ 4: `ctrl+o` or a click on the block. Collapsed→full is Pi's own state, not ours — `compact`
  never rewrites the block, it only decides where the block sits.
- `ctrl+o` on the **row** walks the whole group: level 3 for every command at once, then level 4,
  then back to the row.
- A thought is never a compact `└` line and has no rung of its own: it stays where Pi drew it, at
every level, with Pi's own click. Each call draws its own block at the native levels, so the thought
sits between them.
- Nothing is remembered across a new call: whichever level you left a row on, the next call takes
  the row over and the finished group falls back to level 1.

### The same ladder for one call

An edit has no level 2 — there are no `└` lines — so it goes from its row straight to Pi's block.
A read does have level 2 now: its files (§3).

```text
before:   ✓ Reading 2 files (src/b.ts) ctrl+o to expand · 3s

after:    read
            src/a.ts
          ──────────────────────────
          <file contents>

          read
            src/b.ts
          ──────────────────────────
          <file contents>
```

The hint appears only while something is closed behind the row: a file body, a diff, a folded
group. A live group already showing its `└` lines, and a single command row showing `└ $ cmd`,
carry no hint — click the row or the line instead.

---

## 5. Text and thinking between calls (`compact`)

**Shipped:** the `(thinking Ns)` bracket borrows the live row's target slot, before its duration —
`● Running 2 commands (thinking 4s) · 26s` — and the row's timer keeps running for as long as the
thought streams. In `compact` the hidden-thinking label is blanked for the session, so a hidden
thought renders nothing: no label, no spacer, no gap. `full` restores the label, and a thinking-only
turn draws nothing in `compact` beyond the bracket.

A run is drawn by its **slots**, not by one mount: the first call draws the header, and every later
call draws its own `└` line at its own transcript position. That matters when Pi is set to show
thinking — the italic block renders, nothing is hidden, and the run still reads in order. The full
model, the label rule and their costs are in `plan/thinking-in-frame.md`.

Opening the row to Pi's view brings that call's thought back as a collapsed `Thinking...` line above
the call's own block, with one blank line between them; a further click expands it to Pi's text. The
row and group levels never draw it.

### Visible text splits the group

```text
✓ Reading 2 files (src/b.ts) ctrl+o to expand · 3s

Here is what I found. The config lives in two files…

✓ Running 1 command · 1s
  └ $ ls
```

A row sits where its calls ran — it never slides below the text that came after it.

### Compatible calls continue the same group

After a settled command, a thought streams in Pi's native block below the open row. The row carries
only its bracket, and Pi's label can be clicked normally:

```text
● Running 1 command (thinking 4s) · 1s
  └ ✓ $ npm run build

 Thinking...
```

When `npm test` arrives next, it draws its own line in its own slot and the run keeps one header:

```text
● Running 2 commands · 6s
  └ ✓ $ npm run build

 Thinking...

  └ … $ npm test
```

The order is the transcript order — nothing is moved, hidden or replayed. The thought stays where
Pi drew it, at any level of the ladder; expanding to Pi's view simply shows each call's own block
with that thought between them:

```text
bash
  npm run build
──────────────────────────────────────────
<build output>

 Thinking...

bash
  npm test
──────────────────────────────────────────
<test output>
```

Click `Thinking...` to open its real text with Pi's own Markdown, style and spacing; that click does
not expand or contract the command group.

- A thought is not a call: it is never counted (`Running 2 commands`, never 3 items), never changes
  the mark, never takes a `$` or a mark of its own, never restarts the timer — the row keeps
  counting while the thought streams and freezes only when the row settles.
- A thought never opens a second running header and never ends a run of the same kind. It cannot
  fold a running command away, because nothing is being folded.
- A thought is visible between the run's lines; hiding Pi's own rows for a single thought needs a
  per-thought visibility API in Pi (the extension cannot reach the bundled component), so `compact`
  leaves it native instead.
- Text, `write`, another kind or a queued message ends the group. A turn with thinking and no tool
  calls draws no rows at all — just Pi's block.

### A whole turn: text → thinking → command → thinking → text

Text, then a thought, then a command, then another thought, then text. In `compact` that is
three things on screen — the text, one row for the call, the text again — plus Pi's two blocks,
which stay exactly as Pi drew them. Nothing of ours draws a line for a thought.

While the command runs and the first thought is still streaming:

```text
Let me check the suite before touching the build.

● Running 1 command (thinking 2s) · 1s
  └ … $ npm test
     > tsc -p tsconfig.json
```

The thought completes, the command keeps going — the bracket goes, nothing else moves:

```text
Let me check the suite before touching the build.

● Running 1 command · 3s
  └ … $ npm test
     > tsc -p tsconfig.json
```

The command finishes, the second thought runs, the answer follows. The row is one line now —
the text after it took the line over — and both thoughts stayed Pi's own blocks:

```text
Let me check the suite before touching the build.

✓ Running 1 command (npm test) ctrl+o to expand · 4s

Good — 42 passing. Building now, and only compiling: dist/ is
generated, so nothing to edit by hand.
```

- The row sits where the call ran: after the first text, before the second. It never slides down
  under the text that came after it.
- Two thoughts in one turn are two of Pi's blocks, untouched; our rows only carry the bracket while one streams.
- The command's `4s` is its own time; neither thought enters the row, the count or the mark.
- `ctrl+o` on the line still gives Pi's block for `npm test` (§4).

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
✓ Running 1 command (npm run build) ctrl+o to expand · 6s

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

---

## 6. Rules, short

1. Column 1 is the gutter, and the mark lives there: `●` while the call runs, `✓` once it has
   finished, `✗` when it failed or was stopped by a gate. The glyph is swapped in place — never
   added at the end of the row — so a finished row never grows or shifts.
2. A row reads `<mark><Verb-ing> <count> <noun> (<target>) [blocked|denied] ctrl+o to expand
   · <duration>`. The verb never flips when the call finishes: only the mark changes and the
   seconds freeze.
3. `✓` done, `✗` failed or stopped. A blocked or denied call says so on the row —
   `✗ Reading 1 file (id_rsa) blocked`, `✗ Running 1 command denied` — never silent.
4. A finished row stays on screen until the next call takes the line over.
5. A row carries `ctrl+o to expand` only while something closed sits behind it: a file body, a
   diff, a folded group. A live group already showing its `└` lines and a single command row
   showing `└ $ cmd` carry no hint. The hint and the duration stay with the text — a duration
   ends its own text and is never pushed out to the display's right edge, so a row ends where its
   text ends.
6. Several shell commands in a row are one group of `└ $ cmd` lines, each with `✓`/`✗`; the
   group's header is the only place a time is printed. Output shows only under the command still
   running; when it finishes its output is hidden — click the line or `ctrl+o` to read it. No
   collapsed one-liner to open first.
7. Thinking streams in the row's target slot — `● Running 1 command (thinking 4s) · 1s` — and
   that bracket is dropped the moment the thought completes. It is never counted as a call and
   never restarts the row's own `· 4s`; the row keeps counting while the thought streams and
   freezes only when it settles.
8. In `compact`, hidden thinking takes no space: Pi's hidden-thinking label is blanked, so its run
   renders nothing, no `└` line gains a gap and no blank line appears between a run's lines. The
   `(thinking Ns)` bracket and the running timer are the only live signal. Opening the row shows a
   collapsed `Thinking...` above that call's block; a further click expands it.
9. A message arriving mid-turn (queued `Steering:` / `Follow-up:`) is never grouped: it ends the
   group above it, starts nothing of its own, and is drawn exactly as Pi draws it.
10. `write` is never collapsed: Pi's full block, content and all, even in `compact`.
11. Visible text splits a group; a row never slides below text that came after it.
12. Four levels, same row: 1 one line, 2 the group's `└` lines, 3 Pi's block with the result
    collapsed, 4 Pi's block with the result full. Clicking a folded row asks for level 2 first for
    a shell **and** a read run; a row that is already open, and an edit (no `└` lines), go straight
    to level 3. The row's mark, count, target and duration never change on the way.
13. No summary line, no footer, no "done" line. Nothing is drawn when the turn ends.
14. `full` looks exactly like Pi does today: no rows, and Pi's own hidden-thinking label is
    restored, so thinking reads as Pi renders it.
15. Wide or narrow terminal, the row is cut with `…` instead of wrapping.
16. Clicking the group row folds its `└` list to one line (`3 commands (<last>)`) and back;
    clicking a command line swaps that line for Pi's `full`-mode block, and `ctrl+o` on the
    group row opens every command in it at once — folded or not.
17. A group row's mark is the last command's mark, never "any command failed": the run that
    ends `✓`, `✗`, `✓` reads `✓`, and the failure stays visible on its own `└ ✗` line.
