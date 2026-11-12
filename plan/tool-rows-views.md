# Tool rows

**Status:** the collapsed row is shipped for shell commands and reads. Shipped: the mark in
column 1, a `  └` line per command with its own mark and duration, the fold to one line once a
later call starts, the `(last command)` target, `blocked` / `denied` on the row, the
`(thinking Ns)` bracket on the live row, a 70 %-wide command column, every duration right-aligned
in one column at the display's right end, the group's `└` lines as the first click level (§4),
`Reading N files` rows for `read`, a `Thinking...` line at the bottom of the newest row that opens
into the thought (§5), `  └ ~ thinking 4s` records inside the group, and Pi's own block on expand
— `compact` wraps Pi's own components in Pi's own frame and never redraws them. Pi's own hidden
`Thinking...` label is blanked while a row is on screen, because the label is one global setting:
`compact` draws the thought itself, so `Thinking...` appears once, at the point, instead of once
per message. Not shipped: rows for `edit` / `codemode` (§1, §3) and per-`└`-line clicks (§4).

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
| grouped | that command finished, its group is still the newest row | one `└ ✓ $ cmd 1.2s` line per command, output gone |
| one line | a later call started | the whole group as a single row, `└` lines gone |

The newest group always keeps its `└` lines. Everything above it has already become one line, so
the transcript reads as one line per finished group and the live group only opened up.

Thinking rides on the row while it streams — `● Running 1 command (thinking 4s) · 1s` — and the
thought itself gets one line under the row, `Thinking...`, which opens on a click. When the next
command starts that line becomes a `  └ ~ thinking 4s` record inside the group, so the live
thought is always the only `Thinking...` on screen (§5).

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
✓ Reading 2 files (src/loader.ts) ctrl+o to expand                                              · 3s

✗ Running 1 command (npm test) ctrl+o to expand                                                · 12s

✓ Reading 1 file (src/settings.ts) ctrl+o to expand                                             · 1s

✓ Running 1 command (git status) ctrl+o to expand                                               · 1s

✓ Editing 1 file (src/settings.ts) +5 -3 ctrl+o to expand                                       · 2s
```

That is the whole feature: 6 blocks → 5 rows, same information, `ctrl+o` when you need a body.
Only the newest row still has anything open — every group above it was folded to one line by the
call that came after it. Nothing extra is drawn when the turn ends — the last row just stays
there.

### `compact`, when the commands come in a run

Commands that follow each other with nothing in between share one row, and every command keeps
its own `└` line:

```text
✓ Reading 1 file (src/settings.ts) ctrl+o to expand                                             · 1s

✓ Running 3 commands                                                                            · 4s
  └ ✓ $ npm run typecheck                                                                       1.1s
  └ ✗ $ npm test                                                                                2.4s
  └ ✓ $ git status                                                                              0.2s
```

- Same row shape as above, `3 commands` instead of `1 command`, one line per command in the
  order it ran. The lines are open because this is the newest row on screen.
- `✓` / `✗` per line, each with its own duration. The row's own mark is the mark of the command
  that ran last: this run ends `✓`, `✗`, `✓`, so the row reads `✓` and the failure keeps its own
  `└ ✗` line.
- No output under a finished command: it is drawn only under the command still running and
  hidden the moment that one ends (§3). The frozen lines are the whole record.
- The next call folds the whole list to `✓ Running 3 commands (git status) ctrl+o to expand · 4s`
  (below). `ctrl+o` on the row opens every command as Pi's own block; clicking a single `└` line
  opens just that one.

### `compact`, once a later call starts: one line per group

The next tool call is the signal: the group above it stops showing its `└` lines and becomes a
single row. Nothing on the row itself moves — only the lines go away.

```text
✓ Reading 1 file (src/settings.ts) ctrl+o to expand                                             · 1s

✓ Running 3 commands (git status) ctrl+o to expand                                              · 4s

✓ Editing 1 file (src/settings.ts) +5 -3 ctrl+o to expand                                       · 2s
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

### `compact`, a single call on one line

One call is one line — no `└` child, no second line, whatever the call was:

```text
✓ Reading 1 file (src/config.ts) ctrl+o to expand                                               · 1s

✓ Editing 1 file (src/settings.ts) +5 -3 ctrl+o to expand                                       · 2s

✗ Reading 1 file (id_rsa) blocked
```

- `1 file` / `1 command`, never `1 files` or `1 commands`.
- `ctrl+o to expand` only when there is a body behind the row (a file content, a diff, a
  group); a blocked or denied call has nothing to open, so the hint is left off.
- Still running: `● Reading 1 file (src/config.ts) · 1s` — the `●` and the ticking seconds are
  the only difference; when it lands that same first column becomes `✓`.
- A single `bash` call is the one case that adds a line, because the command itself is the thing
  you want to read:

```text
✓ Running 1 command                                                                             · 4s
  └ $ npm view hunk version
```

  It is never grouped (`Running 1 commands` does not exist), carries no `ctrl+o to expand`
  hint while it is the newest row, and keeps its output while it runs (§2). Once a later call
  starts, the pair folds to `✓ Running 1 command (npm view hunk version) ctrl+o to expand · 4s`.

---

## 2. What happens while it runs (`compact`)

Three moments of one `bash` call, with a thought in the middle:

```text
● Running 1 command (thinking 1s)                                                               · 2s
  └ $ npm view hunk version
```
```text
● Running 1 command                                                                             · 2s
  └ $ npm view hunk version
```
```text
✓ Running 1 command                                                                             · 4s
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
  settles. The thought also gets its own line under the row — `Thinking...` — which opens into the
  text on a click and becomes a `  └ ~ thinking 4s` record when the next command starts (§5).
- The `└` line keeps the command, minus noise: `cd <cwd> && `, wrappers (`sudo`, `uv run`,
  `env A=1`) and the interpreter are dropped (`python3 -m pytest …` reads `pytest …`), and a
  pipeline or chain is kept whole — only the folded header names the last segment. The command
  may take up to 70 % of the width — then `program arg … tail`, then `program … tail`, then the
  program alone. Every duration — the row's own and each command's — is the last thing on its
  line, right-aligned in one column at the display's right end; the `ctrl+o to expand` hint stays
  with the text, just before it.
- The `└` line lives only while this is the newest row: one call later, the pair reads
  `✓ Running 1 command (npm view hunk version) ctrl+o to expand · 4s` (§1).
- When the whole turn ends, nothing new appears: the last row stays as it is. No "done" line,
  no summary line.

---

## 3. Small cases

| Case | `full` | `compact` |
| --- | --- | --- |
| one read | full block with file body | `✓ Reading 1 file (src/a.ts) ctrl+o to expand · 1s` |
| 3 reads in a row | 3 blocks | `✓ Reading 3 files (src/c.ts) ctrl+o to expand · 4s` |
| read + bash | 2 blocks | `✓ Reading 1 file & Running 1 command · 3s` |
| bash fails | block with error text | `✗ Running 1 command · 12s` + `└ $ npm test` |
| read blocked by policy | block with "blocked by policy" | `✗ Reading 1 file (id_rsa) blocked` |
| user denies the ask | block with "denied by user" | `✗ Running 1 command denied` + `└ $ curl https://x` |
| edit a file | block with the diff | `✓ Editing 1 file (src/a.ts) +5 -3 ctrl+o to expand · 2s` |
| write a file | block with full content | **same as `full`** — a write is never collapsed (below) |
| codemode, 2 inner calls | 1 block with script + call log | `✓ Running codemode · 3s` + 2 `└` lines (below) |
| 3 shell commands in a row | 3 blocks | `✓ Running 3 commands · 5s` + 3 `└` lines (below) |
| 3 shell commands, folded | 3 blocks | `✓ Running 3 commands (git status) ctrl+o to expand · 4s` — click the row to unfold |
| 3 shell commands at once | 3 blocks | `● Running 3 commands · 1s` + 3 `…` lines (below) |
| thinking between commands | block, then block | `Thinking...` at the bottom of the row, then `  └ ~ thinking 4s` inside the group once the next command starts; the group is not split (§5) |
| thinking, no tools | thinking block, then answer | nothing new is drawn |
| ask is open | ask prompt | `● Waiting on your answer · 2s` (one line only) |
| long command, 40 cols | Pi wraps it | `● Running 1 command · 4s` + truncated `└ $ rg -n "toolTitle…` |

### codemode with inner calls (`compact`)

```text
✓ Running codemode                                                                              · 3s
  └ await tools.searchTools("rank")
  └ ✓ mcp:dev-radius:search rank                                                               120ms
  └ ✓ read src/config.ts                                                                         8ms
```

Inner calls never become rows of their own, and they are not counted separately: the turn
reports `used codemode ×1`.

### Shell commands one by one (`compact`)

Several `bash` calls with nothing between them are one group. Every command keeps its own
`└ $ cmd` line in the order it ran — no collapsed one-liner you have to open first, and no
output under a finished command:

```text
● Running 2 commands                                                                            · 5s
  └ ✓ $ npm test                                                                                1.2s
  └ … $ npm run build
     > tsc -p tsconfig.json
```

When they finish, the output goes away and only the command lines stay:

```text
✓ Running 2 commands                                                                            · 5s
  └ ✓ $ npm test                                                                                1.2s
  └ ✓ $ npm run build                                                                           3.0s
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
✓ Running 2 commands                                                                            · 5s
  └ ✓ $ npm test                                                                                1.2s

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
✓ Running 1 command                                                                             · 4s
  └ $ npm view hunk version
```

### Several commands at once (`compact`)

One batch of `bash` calls that Pi runs together is still a single group, and every command in it
is running at the same moment — so every line carries `…` and draws its own output:

```text
● Running 3 commands                                                                            · 1s
  └ … $ npm test
     > tsc -p tsconfig.json
  └ … $ npm run lint
  └ … $ git status
     On branch main
```

Each line settles on its own, with its own mark and its own duration; the group ends when the
last one does:

```text
✓ Running 3 commands                                                                            · 4s
  └ ✓ $ npm test                                                                                3.2s
  └ ✓ $ npm run lint                                                                            2.1s
  └ ✓ $ git status                                                                              0.3s
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
✓ Reading 1 file (src/a.ts) ctrl+o to expand                                                    · 1s

write
  README.md
────────────────────────────────────────
# auto-permission-system

…full file content, exactly as in `full` view…

✓ Running 1 command                                                                             · 1s
  └ $ git status
```

`edit` is still collapsed (it already shows `+5 -3`); only `write` opts out, because the whole
file content is the thing you want to see.

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
✓ Running 3 commands (git status) ctrl+o to expand                                              · 4s
```

### Level 2 — the group's lines

```text
✓ Running 3 commands                                                                            · 4s
  └ ✓ $ npm run typecheck                                                                       1.1s
  └ ✗ $ npm test                                                                                2.4s
  └ ✓ $ git status                                                                              0.2s
```

### Level 3 — Pi's block for one call, result collapsed

Click the `└ ✗ $ npm test 2.4s` line and only that call turns into Pi's own block; the other
lines stay as rows:

```text
✓ Running 3 commands                                                                            · 4s
  └ ✓ $ npm run typecheck                                                                       1.1s

bash
  npm test
──────────────────────────────────────────
✗ tests/rows-summary.mjs (7)
… 11 more lines · ctrl+o to expand

  └ ✓ $ git status                                                                              0.2s
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
- A thought line is its own click, on any level: the bottom `Thinking...` of the newest row and a
  `└ ~ thinking 4s` record both open the thought text under the line (§5). It never changes the
  row's level.
- Nothing is remembered across a new call: whichever level you left a row on, the next call takes
  the row over and the finished group falls back to level 1.

### The same ladder for one call

A read or an edit has no level 2 — there are no `└` lines — so it goes from its row straight to
Pi's block:

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
thought streams. Pi's hidden-thinking label is one global setting, so Pi cannot show "only the
newest" thought: `compact` blanks it for as long as it has a row on screen and draws the thought
itself — one `Thinking...` line at the point, which opens into the text on a click. A thought
therefore never stacks: the previous one is a `  └ ~ thinking 4s` record inside the group. Pi's
italic thought text is still Pi's when thinking is set to visible: no extension API hides it, and
`compact` never rewrites it.

### Visible text splits the group

```text
✓ Reading 2 files (src/b.ts) ctrl+o to expand                                                   · 3s

Here is what I found. The config lives in two files…

✓ Running 1 command                                                                             · 1s
  └ $ ls
```

A row sits where its calls ran — it never slides below the text that came after it.

### Thinking is one line at the point

While a thought streams, one line sits at the bottom of the newest row, and the row's target slot
carries its timer:

```text
● Running 1 command (thinking 4s)                                                              · 1s
  └ … $ npm run build
Thinking...
```

Click that line and the thought opens under it, wrapped to the width; click again and it closes:

```text
● Running 1 command (thinking 9s)                                                             · 12s
  └ … $ npm run build
Thinking...
  Run the suite first. If it is green, build — dist/ is generated output,
  so never edit those files by hand.
```

The line stays after the thought completes, so it can still be opened, and it is the only one on
screen: when the next command starts, that thought becomes one record line inside the group and
the new thought — if there is one — takes the bottom again.

```text
● Running 2 commands                                                                             · 3s
  └ ✓ $ npm run build                                                                          2.0s
  └ ~ thinking 4s
  └ … $ npm test
```

- `Thinking...` is the thought at the point; `  └ ~ thinking 4s` is the same thought once a call
  follows it. Both open the same way, and both belong to the row that was live at the time.
- The record line is a group line: it folds away when the group folds to one line and comes back
  with the other `└` lines when the row is opened (§4). The bottom `Thinking...` line of the
  newest row stays visible, folded or not, until a newer group takes the bottom.
- A thought that starts before the first call of a turn is adopted by the row that call opens, so
  no thought is lost and none is drawn twice.
- A thought is not a call: it is never counted (`Running 1 command`, never 2 items), never changes
  the mark, never restarts the timer — the row keeps counting while the thought streams and
  freezes only when the row settles.
- A thought never splits a group: thinking between two commands still leaves one group, and
  `ctrl+o` on that group opens only the commands.
- A turn with thinking and no tool calls draws no rows at all. Before the first row of a session
  Pi draws its own `Thinking...`; once `compact` has a row on screen the label is blank for the
  rest of the session, so a later tool-free turn shows no thinking line — its thought is read
  through the rows of that turn instead.

### A whole turn: text → thinking → command → thinking → text

Text, then a thought, then a command, then another thought, then text. In `compact` that is
three things on screen — the text, one row for the call, the text again — with the thought on one
line under its row.

While the command runs and the first thought is still streaming:

```text
Let me check the suite before touching the build.

● Running 1 command (thinking 2s)                                                               · 1s
  └ … $ npm test
     > tsc -p tsconfig.json
```

The thought completes, the command keeps going — the bracket goes, nothing else moves:

```text
Let me check the suite before touching the build.

● Running 1 command                                                                             · 3s
  └ … $ npm test
     > tsc -p tsconfig.json
```

The command finishes, the second thought runs, the answer follows. The row is one line now —
the text after it took the line over — and the thought is Pi's, in its own place:

```text
Let me check the suite before touching the build.

✓ Running 1 command (npm test) ctrl+o to expand                                                 · 4s

Thinking...

Good — 42 passing. Building now, and only compiling: dist/ is
generated, so nothing to edit by hand.
```

- The row sits where the call ran: after the first text, before the second. It never slides down
  under the text that came after it.
- Two thoughts in one turn produce no rows at all — only the bracket while one streams next to a
  call.
- The command's `4s` is its own time; neither thought enters the row, the count or the mark.
- `ctrl+o` on the line still gives Pi's block for `npm test` (§4).

### A queued message breaks the group

A message that arrives while the agent is still working is never folded into a row and never
grouped across. Pi draws it as it always does — the dim `Steering:` / `Follow-up:` lines in the
pending area, then a normal user message in the transcript when it lands. The rows stop at that
point and start again after it:

While it is still queued, the running row stays above it, untouched:

```text
● Running 1 command                                                                             · 3s
  └ … $ npm run build
     > tsc -p tsconfig.json

Steering: stop after this build, run the linter next
↳ alt+up to edit all queued messages
```

When it lands mid-turn, the group above ends and the next command opens a new one — never
`Running 2 commands`:

```text
✓ Running 1 command (npm run build) ctrl+o to expand                                            · 6s

stop after this build, run the linter next

● Running 1 command                                                                             · 2s
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
   showing `└ $ cmd` carry no hint. The hint stays with the text; the duration is the last thing
   on the line.
6. Several shell commands in a row are one group of `└ $ cmd` lines, each with `✓`/`✗` and how
   long it took. Output shows only under the command still running; when it finishes its output
   is hidden — click the line or `ctrl+o` to read it. No collapsed one-liner to open first.
7. Thinking streams in the row's target slot — `● Running 1 command (thinking 4s) · 1s` — and
   that bracket is dropped the moment the thought completes. It is never counted as a call and
   never restarts the row's own `· 4s`; the row keeps counting while the thought streams and
   freezes only when it settles.
8. Thinking gets exactly one line: `Thinking...` at the bottom of the newest row, which opens
   into the thought on a click. When a call follows it, it becomes one `  └ ~ thinking 4s` record
   inside the group — a group line, folded with the rest. Pi's own hidden-thinking label is
   blanked while `compact` has a row on screen, because that label is one global setting: without
   it, every message with a thought would add another `Thinking...` line. The `(thinking Ns)`
   bracket on the row is only the live timer, and it disappears when the thought completes.
9. A message arriving mid-turn (queued `Steering:` / `Follow-up:`) is never grouped: it ends the
   group above it, starts nothing of its own, and is drawn exactly as Pi draws it.
10. `write` is never collapsed: Pi's full block, content and all, even in `compact`.
11. Visible text splits a group; a row never slides below text that came after it.
12. Four levels, same row: 1 one line, 2 the group's `└` lines, 3 Pi's block with the result
    collapsed, 4 Pi's block with the result full. Clicking a folded row asks for level 2 first; a
    row that is already open, and a read (no `└` lines), go straight to level 3. The row's mark,
    count, target and duration never change on the way.
13. No summary line, no footer, no "done" line. Nothing is drawn when the turn ends.
14. `full` must look exactly like Pi does today. No rows, no timers, no relabelled thinking —
    Pi's thinking block, its `Thinking...` label and its own clicks stay as they are.
15. Wide or narrow terminal, the row is cut with `…` instead of wrapping.
16. Clicking the group row folds its `└` list to one line (`3 commands (<last>)`) and back;
    clicking a command line swaps that line for Pi's `full`-mode block, and `ctrl+o` on the
    group row opens every command in it at once — folded or not.
17. A group row's mark is the last command's mark, never "any command failed": the run that
    ends `✓`, `✗`, `✓` reads `✓`, and the failure stays visible on its own `└ ✗` line.
