# Tool rows — examples

Two views, one switch:

| View | What you see |
| --- | --- |
| `full` | today's Pi output. Nothing changes, nothing is added. This is the "off" state. |
| `compact` | consecutive shell commands squeezed into one `Running N commands` row. Everything else — `read`, `edit`, `write`, `ls`, `grep`, `find`, `codemode`, MCP and extension tools — is drawn exactly as Pi draws it (ADR-050). |

A group reads:

```text
<mark> Running <count> command(s) · <duration> [ctrl+o to expand]
   └ <mark> $ <command> <duration>
```

- Column 1 is the worst mark of the group: `●` while something runs, `✓` ok, `✗` failed,
  `✗ blocked` / `✗ denied` for our own gates.
- The verb never flips when the call finishes: the seconds stop ticking and the mark in column 1
  turns from `●` into `✓` / `✗`.
- A single command is its own row with a plain `└ $ <command>` second line — no mark, no duration,
  no expand hint.
- Two or more commands get one `└ <mark> $ <command> <duration>` line each, newest eight, older
  ones behind `└ ... (<N> earlier calls)`.
- Frames below assume a 100-column terminal. `<…>` = the real output, shortened here.

---

## 1. The same four calls, both views

### `full` (today — nothing added)

```text
read
  src/config.ts
──────────────────────────────────────────
<file contents>

bash
  npm test
──────────────────────────────────────────
<test output, exit 1>

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
read
  src/config.ts
──────────────────────────────────────────
<file contents>

✗ Running 2 commands · 13s ctrl+o to expand
   └ ✗ $ npm test · 12s
   └ ✓ $ git status · 1.2s

edit
  src/settings.ts
──────────────────────────────────────────
Successfully replaced 1 block
```

The `read` and the `edit` are byte-identical to the `full` frame: we never restyle a tool we do
not own. Only the two commands in the middle were compacted into one row.

---

## 2. What happens while it runs

```text
 ● Running 2 commands · 3s ctrl+o to expand
   └ ✓ $ npm test · 1.2s
   └ … $ npm run build · 1.8s
```

```text
✓ Running 2 commands · 5s ctrl+o to expand
   └ ✓ $ npm test · 1.2s
   └ ✓ $ npm run build · 3.8s
```

- `●` in column 1 while any command runs, `…` on the command line that is still going; both turn
  into `✓` as the calls finish, and the durations freeze.
- The seconds only move forward: a component Pi recreates mid-call does not restart the clock.
- A row stays on screen until a later call takes its place. When the turn ends nothing new is
  drawn — no footer, no summary, no "done" line.

---

## 3. Small cases

| Case | `full` | `compact` |
| --- | --- | --- |
| one command | block with command and output | `✓ Running 1 command · 1s` + `└ $ git status` |
| three commands in a row | three blocks | `✓ Running 3 commands · 5s` + three `└` lines |
| command fails | block with error text | `✗ Running 1 command · 12s` + `└ $ npm test` |
| command blocked by policy | block with "blocked by policy" | `✗ blocked Running 1 command · 1s` + `└ ✗ blocked $ cat ~/.ssh/id_rsa` |
| user denies the ask | block with "denied by user" | `✗ denied Running 1 command · 1s` + `└ ✗ denied $ curl https://x` |
| eleven commands in a row | eleven blocks | header + newest eight lines + `└ ... (3 earlier calls)` |
| a command between two reads | blocks, all three | `read` block, row, `read` block — the row sits where its calls ran |
| long command, 40 cols | Pi wraps it | `● Running 1 command · 4s` + `└ $ rg -n "toolTi…` |
| `write` between two commands | block | Pi's own block; it ends the group, so the next command starts a new row |
| `codemode`, inner calls | one block | Pi's own block with its call log — never a row |
| an ask is open | ask prompt | the row stays as it is; nothing is added while the ask is on screen |

---

## 4. What ends a group

Two commands are only ever grouped when they really ran next to each other. The group closes on:

- any other tool call — `read`, `edit`, `write`, `ls`, `grep`, `find`, `codemode`, an MCP tool, an
  unknown tool;
- a user message (`Steering:` / `Follow-up:` included), drawn exactly as Pi draws it;
- an assistant reply that carries text. A reply that only calls tools keeps the group open, so a
  command in the next turn joins the same row — Pi's turn is one model response, and this is the
  rule that makes three `bash` calls drawn over three turns one `Running 3 commands` row;
- `/tool-view full`, or the end of the session.

```text
✓ Running 1 command · 1s
   └ ✓ $ ls

Here is what I found. The config lives in two files…

✓ Running 1 command · 2s
   └ ✓ $ cat src/config.ts
```

---

## 5. The row opens in two steps

A click, or `ctrl+o`, walks the row through three states. Each one is Pi's own renderer, called and
never copied, so nothing is restyled:

| State | What is drawn |
| --- | --- |
| the row | `✓ Running 2 commands · 1.2s ctrl+o to expand` |
| first click | Pi's collapsed block per command: the command line plus a preview of the output |
| second click | Pi's expanded block per command: the command line plus the whole output |
| third click | the row again |

First click — Pi's collapsed block, output preview and all:

```text
bash
  npm test
──────────────────────────────────────────
<the last few lines of the output>
... (12 earlier lines, ctrl+o to expand)
```

Second click — Pi's expanded block, in the order the commands ran:

```text
bash
  npm test
──────────────────────────────────────────
<the whole output>

bash
  npm run build
──────────────────────────────────────────
<the whole output>
```

`ctrl+o` jumps straight to the second state, and pressing it again returns the row. A click is taken
before Pi toggles its own expansion, so the two never fight over the same keystroke or click
(ADR-053).

Nothing is added to Pi's block and nothing is taken away: every state is Pi's output, byte for byte.

---

## 6. Not drawn yet

These frames are the target, not the shipped view (see `TOOL_ROWS_REQUIREMENTS.md` §10):

- **Output under the running command.** A row never draws a tool's output; the running command's
  block is one `ctrl+o` away.

  ```text
   ● Running 2 commands · 5s
     └ ✓ $ npm test 1.2s
     └ … $ npm run build
        > tsc -p tsconfig.json
  ```

- **Clicking one `└` line** to open only that command, leaving the other lines as rows. A line
  inside our own component has no mouse region; only the whole row can be clicked.
- **A `~ Thought for 4s — click to read` row.** Thinking stays Pi's own block in both views, so a
  thought between two commands does not split the group yet.
- **Rolling file calls up** (`Reading 3 files (src/c.ts)`). Out of scope after ADR-050: those tools
  keep Pi's block.
