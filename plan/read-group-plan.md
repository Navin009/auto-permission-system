# Combined view for file reads

**Status:** shipped. Display-only change: nothing here touches L1 (OS sandbox), L2 (tool guard) or
the policy file. Landed: the file list, the range suffix, the folded-only header target, the extra
ladder step, and the hint rule. Not landed: per-`└`-line clicks — the click is still the whole
row, for reads and commands alike (`plan/tool-rows-views.md`, status line).

**One line:** a run of `read` calls becomes a group with one `└` line per file — exactly like a run
of shell commands — instead of a single `Reading N files` row that jumps straight into Pi's blocks.

---

## 1. Where we are today

A run of `read` calls already joins one row: the group is created by tool kind, and consecutive
`read` calls with nothing in between share it (`src/tool-view/row-groups.ts`, `groupForCall`).

What the group never shows is its files. In `src/core/tool-view/row-kind.ts` the read label is
declared with `showsChildLines: false`, and `rowGroupLines` / `commandLines` in
`src/core/tool-view/row-group.ts` return an empty list for any kind with that flag. So a read group
is always drawn as if it were folded: count, one target, hint, duration — never a list.

The expand ladder then skips a level. `hasGroupStep()` in `src/tool-view/row-groups.ts` asks the
same `showsChildLines` flag, so `nextExpansionLevel()` (`src/core/tool-view/expansion-level.ts`)
goes **Row → Collapsed → Full** for reads and only **Row → Group → Collapsed → Full** for shell.

Result: one click on `✓ Reading 3 files (src/c.ts) ctrl+o to expand · 4s` dumps three whole file
bodies. You never get the cheap middle step — "which files were these?" — that a command group
gives you for free.

```text
today, 3 reads:

✓ Reading 3 files (src/c.ts) ctrl+o to expand · 4s

today, one click (or ctrl+o), all at once:

read
  src/a.ts
──────────────────────────────────────────
<file contents>

read
  src/b.ts
──────────────────────────────────────────
<file contents>

read
  src/c.ts
──────────────────────────────────────────
<file contents>
```

---

## 2. The change in one picture

Reads get the same four levels a command group has. The middle level is new.

```text
level 1 (folded, after a later call)

✓ Reading 3 files (src/c.ts) ctrl+o to expand · 4s

level 2 (newest row — the file list)

✓ Reading 3 files · 4s
  └ ✓ src/config.ts 0.3s
  └ ✓ src/loader.ts 0.4s
  └ ✓ src/settings.ts 0.2s

level 3 (one file, content collapsed — Pi's own block)

✓ Reading 3 files · 4s
  └ ✓ src/config.ts 0.3s

  read
    src/loader.ts
  ──────────────────────────────────────────
  ⋯ 84 more lines · ctrl+o to expand

  └ ✓ src/settings.ts 0.2s

level 4 (same file, full content — Pi's own block)

  read
    src/loader.ts
  ──────────────────────────────────────────
  <every line>
```

Nothing on the header changes on the way down and back: the mark, the count, the target when
folded, and the duration stay where they are.

---

## 3. The child line

`└ <mark> <path>[:<range>] [blocked|denied] [<duration>]` — same glyphs, same dim style, same
column budget as `└ $ cmd`.

| Piece | Rule |
| --- | --- |
| indent + mark | `  └ ` then `✓` / `✗` / `…`; no mark on a group of one, exactly like `└ $ cmd` |
| no prompt | reads carry no `$` — the path is the thing, not a command |
| path | the `file_path` / `path` argument as Pi's `read` reported it, whitespace collapsed to one line |
| range | when Pi read a slice, the slice ends the path: `src/app.ts:120-179`; a whole-file read has no suffix |
| word | `blocked` / `denied` straight after the path, the same words the header uses |
| duration | only on a settled line, at the end of its own text; a running line is `…` and grows nothing |
| width | 70 % of the terminal, like `└ $ cmd`; cut with `…` from the left at a path-segment boundary so the file name survives |
| overflow | newest 8 lines, older ones become `  └ ... (2 earlier calls)` |

Why no `$`: a shell line says "this is the command that ran"; a read line already names the file.
A prompt in front of a path (`$ src/a.ts`) reads like someone tried to execute it.

Two reads of the same file are two lines — `src/a.ts:1-80` and `src/a.ts:400-420` are different
work, and a `×2` badge would hide which slice ran. A repeated whole-file read just repeats its
line.

---

## 4. Frames

100-column terminal. `<…>` = real output, shortened.

### Three reads in a row

While the last one still runs:

```text
● Reading 3 files · 1s
  └ ✓ src/config.ts 0.3s
  └ ✓ src/loader.ts 0.4s
  └ … src/settings.ts
```

Settled — the run is still the newest row, so the list stays open:

```text
✓ Reading 3 files · 4s
  └ ✓ src/config.ts 0.3s
  └ ✓ src/loader.ts 0.4s
  └ ✓ src/settings.ts 0.2s
```

The next call takes the row over and the list becomes one line:

```text
✓ Reading 3 files (src/settings.ts) ctrl+o to expand · 4s
```

- The header's mark is the last read's mark, never "one of them failed".
- `3 files` counts reads, not files — three reads of one file read `Reading 3 files`.
- The header target is the last path, and it only appears once the row is folded, so the open row
  is the list and nothing else.

### One read

A single read is not a list. It keeps one line, no mark on it, no duration — the same shape a
single command already has:

```text
✓ Reading 1 file · 1s
  └ src/config.ts
```

When a later call starts it folds to today's form:

```text
✓ Reading 1 file (src/config.ts) ctrl+o to expand · 1s
```

### Slices and ranges

```text
✓ Reading 3 files · 2s
  └ ✓ src/core/tool-view/row-group.ts 0.3s
  └ ✓ src/core/tool-view/row-group.ts:120-179 0.2s
  └ ✓ plan/tool-rows-views.md:1-60 0.1s
```

- A range makes the line longer than the path it came from; the file name still wins the cut.
- A read with `offset` and no `limit` reads `path:120` — where it started, exactly as Pi prints it.

### A blocked read inside the run

```text
✓ Reading 3 files · 2s
  └ ✓ src/config.ts 0.3s
  └ ✗ ~/.ssh/id_rsa blocked
  └ ✓ src/c.ts 0.2s
```

- The blocked line carries the word and no duration (there is no work to time).
- The header stays `✓`, because the last read succeeded — the same rule command groups use
  (§6, rule 17 of `tool-rows-views.md`). A run that *ends* blocked reads
  `✗ Reading 2 files (…id_rsa) blocked`.

### A denied read

```text
✗ Reading 2 files (src/b.ts) denied ctrl+o to expand · 6s
```

- The ask was refused, so the whole pair is one failed row and the list never opens.
- `ctrl+o` is left off the folded row of a blocked/denied group only when there is nothing behind
  it; a run with some successful reads still has file bodies, so the hint stays.

### Long paths at 100 / 80 / 60 columns

```text
100  ✓ Reading 1 file (src/core/tool-view/target-summary.ts) ctrl+o to expand · 2s
 80  ✓ Reading 1 file (… core/tool-view/target-summary.ts) ctrl+o to expand · 2s
 60  ✓ Reading 1 file ctrl+o to expand · 2s
```

Inside an open run the same cut applies to the child line, never to the header:

```text
✓ Reading 2 files · 2s
  └ ✓ … core/tool-view/target-summary.ts 0.3s
  └ ✓ src/a.ts 0.1s
```

Narrower than 40 columns the group comes folded, because every line would be `…` — the existing
rule applies to reads unchanged.

### Thinking between two reads

The active thought is Pi's own block in its own place; the row carries only the bracket:

```text
● Reading 2 files (thinking 3s) · 2s
  └ ✓ src/a.ts 0.4s
  └ ✓ src/b.ts 0.2s
```

After those reads settle, the next read suppresses the thought in the ordinary transcript and joins
this same group. At native expansion, the saved `Thinking...` row follows the second file's Pi
block and can still be clicked to reveal its real text. The compact file list never includes it.

### Visible text between reads

```text
✓ Reading 2 files (src/b.ts) ctrl+o to expand · 3s

Here is what I found…

● Reading 1 file · 1s
  └ src/c.ts
```

The text ends the group; no list is reopened across it, and no row slides under it.

### Reads either side of a shell command

Read and shell are different kinds, so they are two rows — today and after this change:

```text
✓ Reading 2 files (src/b.ts) ctrl+o to expand · 3s

✓ Running 1 command · 1s
  └ $ ls
```

The shell row does not join the read list, and a read after the command opens a fresh run. `write`
still never collapses and still ends the current group.

---

## 5. Steps

No code in this document; each step names the file and the behaviour to land.

### Step 1 — the label says reads have children

`src/core/tool-view/row-kind.ts`: the read label becomes `showsChildLines: true`. This one flag
turns on the list *and* the extra `Group` step, because `rowGroupLines` and `hasGroupStep()` read
the same field. Nothing else in the header logic changes.

### Step 2 — a read line is not a command line

`src/core/tool-view/row-group.ts`: the child-line builder stops assuming `$`. Split the per-line
text into "shell" (prompt + command, existing `displayShellCommand` / `fitCommand`) and "read"
(path + range, cut with `fitTarget` at a path boundary). The mark, word and duration pieces stay
shared. Keep the single-line rule (no mark, no duration) and the newest-8 overflow rule as they
are.

### Step 3 — the range suffix

`src/core/tool-view/arguments.ts` (or a small sibling): `read` carries `offset` / `limit` next to
`file_path`. Build the display target as `path` plus `:<start>-<end>` when a slice was asked for,
`:<start>-` when only `offset` was given. The raw `file_path` keeps going to the policy layer
untouched — this is display text, not a second read of the argument.

### Step 4 — an open read header has no target

`src/core/tool-view/row-group.ts`: `targetText` currently shows the last path for reads because
reads were forced into the folded shape. Once the list can open, the target appears only when the
row is folded, like shell. Guard the existing tests that pin
`✓ Reading 3 files (src/c.ts) ctrl+o to expand` so they pass `folded: true`, which is the state
that string now describes.

### Step 5 — the expand ladder

`src/tool-view/row-groups.ts`: `hasGroupStep()` needs no edit once Step 1 lands — verify that a
read row now walks `Row → Group → Collapsed → Full` and that clicking one `└` line swaps only that
line for Pi's block.

`src/tool-view/row-group-component.ts`: confirm the per-line click hit-test covers read lines, and
that a click on a read line and `ctrl+o` on the header do not fight (line click = that file,
`ctrl+o` = every file).

### Step 6 — the hint rule

`src/core/tool-view/row-group.ts`: the hint is shown only while something is closed. An open read
list carries none, a folded row carries it, a single-read row that is open carries none (its file
body is behind the `└` line, and the line is the click). Keep the rule identical to shell so the
two kinds never diverge.

### Step 7 — tests

Extend `security/tests/unit/`:

- `tool-view-kinds.mjs` — the read label reports child lines.
- `tool-view-rows.mjs` — one read = one header plus one unmarked line; three reads = three lines
  with marks and durations; a running line is `…` and has no duration; a blocked line carries the
  word and no duration; the header mark is the last read's mark; nine reads produce one overflow
  line; a slice renders `path:120-179`.
- `tool-view-expansion.mjs` — the ladder for reads is now four steps, and the existing three-step
  expectation for reads is replaced.
- `tool-view-live-duration.mjs` / `tool-view-thinking-rows.mjs` — the read header still takes the
  `(thinking Ns)` bracket, and the bracket never becomes a child line.
- One width test per cut level (100 / 80 / 60) for both the header and a child path.

Then `npm test` and `npm run typecheck`.

### Step 8 — docs

- `plan/tool-rows-views.md`: §1 gains the read frames, §3's `3 reads in a row` row changes, §4's
  ladder note that "a read has no level 2" is deleted, and rule 12 loses its read exception.
- `README.md`: the `compact` description says a run of reads lists its files.
- `skills/auto-permission-system/SKILL.md`: untouched — this is display, not policy.
- `security/manifest.json`: untouched unless the tests change layer status; display work does not.

### Step 9 — commit

`feat(tool-view): list a read run's files as child lines`, with the ladder reasoning and the "why
no `$`" note in the body, per this repo's conventions.

---

## 6. Rules, short

1. A run of consecutive `read` calls is one group; its files are the group's `└` lines.
2. A child line reads `└ <mark> <path>[:<range>] [blocked|denied] [<duration>]`. No `$`.
3. One read in the group draws no mark and no duration on its line — the header already carries
   both, exactly like a single command.
4. The header mark and the header target are the last read's; the count is the number of reads.
5. An open header shows the list and no target; a folded header shows the target and no list.
6. Durations end their own text: the header's after the count (and target), a child line's after
   the path. Nothing is pushed to the right edge.
7. The list is the newest row's alone. The next call folds it to one line, and the fold is
   automatic, not a setting.
8. Click a child line → Pi's block for that file, collapsed; `ctrl+o` again → full content. Click
   it again → the line comes back.
9. `ctrl+o` on the header asks for the list first (`Row → Group`), then every file at once. A row
   never jumps straight into three file bodies from the folded state.
10. A blocked or denied read keeps its word on its own line; the header follows the last read's
    mark, never "any failure".
11. Newest 8 lines; older ones are `└ ... (N earlier calls)`.
12. Thinking is never a child line: it borrows the header's bracket while it streams, then a
    compatible next read suppresses it in the ordinary transcript and joins this run. Native
    expansion retains the clickable Pi thought after the preceding file's block.
13. Visible text, a queued message, `write`, or a different tool kind ends the run; a read after it
    starts a new group.
14. Paths are cut with `…` from the left so the file name survives; below 40 columns the group is
    folded.
15. `full` view is unchanged: no list, no rows, Pi's blocks exactly as today.
16. Nothing is drawn when the turn ends — the last row stays as it is.

---

## 7. Decisions to confirm before coding

| Question | Proposal | Why |
| --- | --- | --- |
| `└ src/a.ts` or `└ read src/a.ts`? | no verb | the header already says `Reading`; a path is not a command |
| offset only | `path:120` | one token, greppable, same shape Pi's own read block prints |
| offset + limit | `path:120-179` | the slice Pi actually read |
| Duplicate reads | two lines | different slices are different work; a `×2` hides which one ran |
| `Reading 3 files` when one file was read 3 times | keep the count | it counts reads; "3 files" is the existing wording for the noun |
| Does the list open by default on the newest row? | yes | same behaviour as a command group, no new setting |
| Per-line click vs. `ctrl+o`, which wins? | line = that file, `ctrl+o` = all | matches shell exactly, so there is one rule to learn |
| Anything security-related? | no | display only; the raw path still reaches the guard and the sandbox unchanged |

---

## 8. Done when

- A run of three reads draws a header and three `└` lines, and folds to one line when the next
  call starts. — **done**
- Clicking a line opens that one file; `ctrl+o` on the header walks the ladder without dumping
  everything on the first press. — **half done**: `ctrl+o`/a click now asks for the list before any
  block, but a click on one line still opens the whole run (per-line clicks are not shipped for
  commands either).
- `Reading 1 file` (single read) keeps its one unmarked line and folds as before. — **done**
- `full` view is pixel-identical to today, and `npm test` / `npm run typecheck` are green. — **done**
