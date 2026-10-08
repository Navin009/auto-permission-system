# Ask-tier prompt examples (after ADR-030)

Every block triggers one or two `ui.select` prompts. This file shows both
screens verbatim, for every gate the system has, with realistic scenarios.
Use it to:

- See what the user actually sees on screen.
- Find places where wording is still ambiguous or still asks too often.

Conventions:

- **Every prompt is a question, and every answer starts with No or Yes.**
  The answers always come in the same order — No · Yes, just this once ·
  Yes, for this session · Yes, always… — so row 2 always means "once".
  Answers that don't apply to a prompt are removed, not greyed out.
- **`>`** marks the highlighted answer that Enter picks. It starts on No
  everywhere except network prompts, where it starts on "Yes, just this
  once" (ADR-024).
- **The footer** says what Esc and no answer do. Today's selector times
  out after `ASK_TIMEOUT_MS` (default 15s).
- **"…"** at the end of an answer opens a second screen.
- **Screen 2 ("Yes, always…")** shows the File and Folder (or Site and
  Group) once at the top. Rows say "All in folder" / "All in group" or
  "Only <name>", then "in this project" or "in all projects".
- **Body fields** are always from this set, in this order: File, Folder,
  Site, Group, Command, Why, Risk, Note. Paths start with `~` for your home
  folder.
- **"(recommended)"** appears only where there's a clear recommendation:
  on screens about credentials or secrets, and on screen 2's preselected
  row.
- **Icons:** ❓ normal ask · ⚠ system change or warning · 🔑 secrets and
  credentials · 🌐 network · 💾 saving a rule. The title still makes sense
  without them.
- Folder / sample values are real-world examples taken from the audit log.

---

## 1. Write — `~/.composio/tool_definitions/x.json`

Trigger: `composio search googleads` tries to create a tool file under its
cache. Layer 1 fences the bash command, the sandbox prints `EROFS:
read-only file system, open '/home/u/.composio/tool_definitions/x.json'`,
the write hook takes over.

### Screen 1 — allow it, and for how long?

```
❓  Let composio save files in ~/.composio/tool_definitions/?

    File     ~/.composio/tool_definitions/x.json
    Command  composio search googleads
    Why      outside your project, not on your allowed list

  > No
    Yes, just this once
    Yes, for this session
    Yes, always…

  Default: No
```

| Answer                | What happens |
| --------------------- | ------------ |
| No                    | composio's save fails and the AI is told you said no. Nothing is saved. |
| Yes, just this once   | composio runs again and can save files in this folder until the command finishes (ADR-021). Nothing is saved. |
| Yes, for this session | Any command can save files in this folder until you quit pi, with no more prompts for it (ADR-030). Nothing is saved to disk. |
| Yes, always…          | Opens screen 2 to choose how wide a permanent rule should be. |

### Screen 2 — only after "Yes, always…"

```
💾  Always allow saving — what, and where?

    File     ~/.composio/tool_definitions/x.json
    Folder   ~/.composio/tool_definitions/
    Note     the rule works for any command, not just composio

  > All in folder    in this project    (recommended)
    Only x.json      in this project
    All in folder    in all projects
    Only x.json      in all projects

  Default: All in folder · in this project
```

| Answer                           | Covers                   | Saved to |
| -------------------------------- | ------------------------ | -------- |
| All in folder · in this project  | every file in the folder | this project's `.pi/sandbox.json` |
| Only x.json · in this project    | just this file           | this project's `.pi/sandbox.json` |
| All in folder · in all projects  | every file in the folder | your global pi settings |
| Only x.json · in all projects    | just this file           | your global pi settings |

The "All in folder" row is preselected (ADR-030). Saving "in this project" needs a
trusted project (ADR-013). If the project isn't trusted, the two "in this
project" rows are hidden and the body shows one more line:

```
    Note     this project isn't trusted — run /security trust to save rules here
```

**Audit** (first line: "Yes, just this once"; second line: "All in
folder, in this project"):

```jsonl
{"layer":1,"tool":"bash","subject":"/home/u/.composio/tool_definitions/x.json","decision":"once","scope":"invocation","note":"write-once","cwd":"…"}
{"layer":1,"tool":"bash","subject":"/home/u/.composio/tool_definitions","decision":"always-cwd","granularity":"folder","scope":"cwd","persisted_to":"…/.pi/sandbox.json","cwd":"…"}
```

---

## 2. Write — second file in the same folder

Trigger: the same `composio search` saves
`~/.composio/tool_definitions/googleads.json` next. You answered "Yes, for
this session" in §1, so this fires **no prompt**. A quiet status line (no
key press needed) tells you why:

```
  ✓ composio saved ~/.composio/tool_definitions/googleads.json
    allowed by your session rule for this folder
```

**Audit** (silent allow via session grant):

```jsonl
{"layer":1,"tool":"bash","subject":"/home/u/.composio/tool_definitions/googleads.json","decision":"write-once","cwd":"…"}
```

This is the win the user wanted: one decision for the whole folder, every
later file inside it is silent.

### One level up still asks

The rule covers `~/.composio/tool_definitions/` only. When composio saves
`~/.composio/user_data.json`, that file is in the parent folder, so you get
a new prompt. The title names the new folder, so you can see it's a
different (wider) place:

```
❓  Let composio save files in ~/.composio/?

    File     ~/.composio/user_data.json
    Command  composio search googleads
    Why      outside your project, not on your allowed list

  > No
    Yes, just this once
    Yes, for this session
    Yes, always…

  Default: No
```

The answers work the same as §1 screen 1.

---

## 3. Write — system file, folder can't be allowed (`/etc/foo`)

Trigger: a bad command tries `sudo tee /etc/foo`. The parent folder `/etc`
isn't safe to allow as a whole, so every "Yes" answer covers **only this
file**. The title names the file (not a folder), so the answers can't be
misread.

### Screen 1 — warning look

```
⚠  Let sudo tee change the system file /etc/foo?

    File     /etc/foo
    Command  sudo tee /etc/foo
    Risk     /etc holds system settings for the whole machine
    Note     only this one file can be allowed, not the /etc folder

  > No   (recommended)
    Yes, just this once
    Yes, for this session
    Yes, always…

  Default: No
```

| Answer                | What happens |
| --------------------- | ------------ |
| No                    | The write fails and the AI is told you said no. Nothing is saved. |
| Yes, just this once   | The command runs again and can change `/etc/foo` only. Nothing is saved. |
| Yes, for this session | Any command can change `/etc/foo` (only this file) until you quit pi. |
| Yes, always…          | Opens screen 2, which offers only "Only foo" rows (no folder). |

### Screen 2 — only after "Yes, always…"

```
💾  Always allow changing — what, and where?

    File     /etc/foo
    Folder   /etc/
    Note     this folder can't be allowed as a whole, only this file

  > Only foo    in this project    (recommended)
    Only foo    in all projects

  Default: All in folder · in this project
```

### Session grant value

For "Yes, for this session", the parent `/etc` fails the safety check
(`isSafeFolderGrant('/etc', home) === false`), so the session grant is the
file: **sessionGrants.push({ kind: 'allowWrite', value: '/etc/foo' })**.
The audit records it:

```jsonl
{"layer":1,"tool":"bash","subject":"/etc/foo","decision":"session","grant":"/etc/foo","note":"folder-unsafe","cwd":"…"}
```

(`note: "folder-unsafe"` is a follow-up; today the audit shows the file grant
without the note.)

---

## 4. Read — `.env` (`askRead`, ADR-019)

Trigger: the AI runs `grep -r TOKEN .env`. The pre-flight ask fires before
the command runs, so nothing has been read yet.

### Screen 1 — no "always" option

```
🔑  Let pi read your .env file?

    File     ~/project/.env
    Command  grep -r TOKEN .env
    Why      .env files usually hold passwords and API keys
    Risk     the AI will see any keys in it
    Note     can't be saved as a permanent rule (it holds secrets)

  > No
    Yes, just this once
    Yes, for this session

  Default: No
```

| Answer                | What happens |
| --------------------- | ------------ |
| No                    | The command doesn't run and the AI is told you said no. |
| Yes, just this once   | The command runs once; the AI sees what it prints from `.env`. |
| Yes, for this session | Any command can read this `.env` until you quit pi. Nothing is saved to disk. |

There's no "Yes, always…": secrets should never be saved as a rule in a
`sandbox.json`. `askRead` only ever prompts.

---

## 5. Read — outside the project (`outsideProject.read = "ask"`)

Trigger: the AI runs `cat ~/notes/todo.md` from inside a project. The
pre-flight detects the outside path before sandbox-exec fences it.

### Screen 1 — allow it, and for how long?

```
❓  Let cat read ~/notes/todo.md? It's outside your project.

    File     ~/notes/todo.md
    Command  cat ~/notes/todo.md
    Why      files outside your project need your OK

  > No
    Yes, just this once
    Yes, for this session
    Yes, always…

  Default: No
```

| Answer                | What happens |
| --------------------- | ------------ |
| No                    | The command doesn't run and the AI is told you said no. |
| Yes, just this once   | The command runs once and can read this file. Nothing is saved. |
| Yes, for this session | Any command can read files in `~/notes/` until you quit pi. Nothing is saved to disk. |
| Yes, always…          | Opens screen 2 to choose how wide a permanent rule should be. |

"Yes, for this session" is the same answer as on write prompts, so the four
rows mean the same thing everywhere.

### Screen 2 — only after "Yes, always…"

```
💾  Always allow reading — what, and where?

    File     ~/notes/todo.md
    Folder   ~/notes/
    Note     the rule works for any command, not just cat

  > All in folder    in this project    (recommended)
    Only todo.md     in this project
    All in folder    in all projects
    Only todo.md     in all projects

  Default: All in folder · in this project
```

### When the file sits directly in your home folder

For `~/todo.md`, the parent is your home folder (`/home/u`). That's too wide
to allow as a whole (`isSafeFolderGrant('/home/u', '/home/u') === false`),
so "Yes, for this session" covers only the file, and screen 2 shows only
the file rows:

```
💾  Always allow reading — what, and where?

    File     ~/todo.md
    Folder   ~/   (your home folder)
    Note     this folder can't be allowed as a whole, only this file

  > Only todo.md     in this project    (recommended)
    Only todo.md     in all projects

  Default: All in folder · in this project
```

---

## 6. Read — `~/.ssh/id_rsa` (absolute deny)

Trigger: the AI runs `cat ~/.ssh/id_rsa`. One screen that starts on No, so
pressing Enter never approves. There's no second "are you sure?" screen.

### Screen 1 — credential warning (the only screen)

```
🔑  Let pi read your SSH private key?

    File     ~/.ssh/id_rsa
    Command  cat ~/.ssh/id_rsa
    Risk     anyone with this key can log in to your servers as you
    Note     can only be allowed for one read at a time

  > No   (recommended)
    Yes, allow this one read

  Default: No
```

| Answer                    | What happens |
| ------------------------- | ------------ |
| No                        | The command doesn't run and the AI is told you said no. |
| Yes, allow this one read  | The command runs once; the AI sees the key. Nothing is saved. |

No "for this session" and no "always": credentials are only ever allowed
one read at a time.

**Audit:**

```jsonl
{"layer":2,"tool":"read","subject":"/home/u/.ssh/id_rsa","reason":"denyRead matched \"~/.ssh\"","decision":"yes","cwd":"…"}
```

(Headless mode would have logged `decision: "no"`.)

---

## 7. Network — `backend.composio.dev` (3-part host)

Trigger: `composio search googleads` connects to
`https://backend.composio.dev/v1/...`. The sandbox-runtime proxy asks
before connecting.

### Screen 1 — starts on Yes (ADR-024)

```
🌐  Let composio connect to backend.composio.dev?

    Site     backend.composio.dev
    Group    *.composio.dev   (every composio.dev site)
    Command  composio search googleads
    Why      this site isn't on your allowed list yet

    No
  > Yes, just this once
    Yes, all in group for this session
    Yes, always…

  Default: Yes, just this once
```

The rows are in the same order as every other prompt; only the cursor
starts lower, on "Yes, just this once" (ADR-024). The footer says plainly
that no answer means Yes.

| Answer                             | What happens |
| ---------------------------------- | ------------ |
| No                                 | The connection is refused; the command may fail. |
| Yes, just this once                | This command can connect to `backend.composio.dev`. Its later connections there don't ask again (ADR-023). Nothing is saved. |
| Yes, all in group for this session | Any command can connect to any `*.composio.dev` site (`api.composio.dev`, `metrics.composio.dev`, …) until you quit pi. Nothing is saved to disk. |
| Yes, always…                       | Opens screen 2 to choose how wide a permanent rule should be. |

### Screen 2 — only after "Yes, always…"

```
💾  Always allow connecting — what, and where?

    Site     backend.composio.dev
    Group    *.composio.dev   (every composio.dev site)
    Note     the rule works for any command, not just composio

  > All in group                in this project    (recommended)
    Only backend.composio.dev   in this project
    All in group                in all projects
    Only backend.composio.dev   in all projects

  Default: All in folder · in this project
```

| Answer                                       | Covers                     | Saved to |
| -------------------------------------------- | -------------------------- | -------- |
| All in group · in this project               | every `*.composio.dev` site | this project's `.pi/sandbox.json` |
| Only backend.composio.dev · in this project  | just this site             | this project's `.pi/sandbox.json` |
| All in group · in all projects               | every `*.composio.dev` site | your global pi settings |
| Only backend.composio.dev · in all projects  | just this site             | your global pi settings |

The "All in group" row is preselected (ADR-030). `picked.pattern` is the
value persisted into `overrides.allowDomains` and applied live to the
running proxy. Audit shows both the pattern that was granted and the site
that asked:

```jsonl
{"layer":1,"tool":"network","subject":"backend.composio.dev","decision":"always-cwd","scope":"cwd","persisted_to":"…/.pi/sandbox.json","pattern":"*.composio.dev","requested":"backend.composio.dev","cwd":"…"}
```

---

## 8. Network — `us.i.posthog.com` (telemetry)

Same shape as §7; only the site and group change. The group is
`*.i.posthog.com`, which covers `us.i.posthog.com`, `eu.i.posthog.com`, etc.

```
🌐  Let composio connect to us.i.posthog.com?

    Site     us.i.posthog.com
    Group    *.i.posthog.com   (every i.posthog.com site)
    Command  composio search googleads
    Why      this site isn't on your allowed list yet

    No
  > Yes, just this once
    Yes, all in group for this session
    Yes, always…

  Default: Yes, just this once
```

### Audit (session grant):

```jsonl
{"layer":1,"tool":"network","subject":"us.i.posthog.com","decision":"session","grant":"*.i.posthog.com","requested":"us.i.posthog.com","cwd":"…"}
```

(The `*.i.posthog.com` group is intentionally narrow — it does NOT cover
posthog's other sites like `app.posthog.com` or `us.posthog.com`. There's
no row for all of `posthog.com`.)

---

## 9. Network — `example.com` (2-part apex)

Trigger: a curl to `https://example.com/api`. There's no useful group —
`*.example.com` wouldn't match `example.com` itself — so every "Yes" covers
only this site.

### Screen 1 — no Group line

```
🌐  Let curl connect to example.com?

    Site     example.com
    Command  curl https://example.com/api
    Why      this site isn't on your allowed list yet

    No
  > Yes, just this once
    Yes, for this session
    Yes, always…

  Default: Yes, just this once
```

With no group, row 3 is plain "Yes, for this session" — it covers only
`example.com`.

### Screen 2 — only "Only example.com" rows

```
💾  Always allow connecting — what, and where?

    Site     example.com
    Note     only this site can be allowed — there's no wider group

  > Only example.com    in this project    (recommended)
    Only example.com    in all projects

  Default: All in folder · in this project
```

The session grant for `example.com` is the exact site — the wildcard
generation returns the host itself for 2-part hosts.

---

## 10. Sensitive command — `env | grep COMPOSIO`

Trigger: the AI runs `env | grep -i composio`. `commands.ask` lists
`^env$`, `^printenv$`, `/proc/[^/]+/environ` — bare invocation only.

### Screen 1 — one run at a time

```
🔑  Let env print your environment variables?

    Command  env | grep -i composio
    Risk     environment variables often hold API keys and tokens
    Note     can only be allowed one run at a time

  > No   (recommended)
    Yes, just this once

  Default: No
```

| Answer              | What happens |
| ------------------- | ------------ |
| No                  | The command never runs and the AI is told you said no (message below). |
| Yes, just this once | The command runs once; the AI sees what it prints. Nothing is saved. |

No "for this session" and no "always" — these commands print too much to
allow broadly.

The pre-flight runs before the sandbox-exec child starts. If you answer No,
the AI sees:

```
❌ pi-sandbox: command blocked — it can print secrets: env. Nothing was run — ask the user.
```

---

## 11. Advanced Secure — sensitive file (`mcp.json`)

Trigger: Layer 2 reads `~/.pi/agent/mcp.json`. The file is in `denyRead`
AND `askRead`, AND Advanced Secure flags it as `strong`-risk for credential
names. Because it's on the protected list (`denyRead`), it gets the same
one-read-only screen as the SSH key in §6.

```
🔑  Let pi read your MCP settings file?

    File     ~/.pi/agent/mcp.json
    Command  read ~/.pi/agent/mcp.json
    Risk     it holds API keys for your MCP servers
    Note     can only be allowed for one read at a time

  > No   (recommended)
    Yes, allow this one read

  Default: No
```

| Answer                    | What happens |
| ------------------------- | ------------ |
| No                        | The read doesn't happen and the AI is told you said no. |
| Yes, allow this one read  | The AI sees the file once, API keys included. Nothing is saved. |

If the AI is told No and tries to get the contents another way (e.g.
`grep`), Layer 2's `tool_result` filter drops the matched lines before they
reach the AI.

---

## 12. Advanced Secure — output gate (redaction prompt)

Trigger: the AI ran `cat deploy.sh`, and the output contains a login token
(JWT). The output filter caught it before the AI saw it.

```
🔑  This output may contain a secret — show it to the AI?

    From     bash: cat deploy.sh
        ...   
    14: export JWT="eyJhbGciasdfadfs..." # show full line
        ...
    Note     you'll be asked again each time a secret shows up

  > No, keep it hidden   (recommended)
    Yes, show it this once

  Default: No
```

The screen never shows the internal rule name (`JWT_ASSIGNMENT`) — it shows
a plain name for what was found, plus the start of the line so you can
recognise it. Each detection rule gets a plain name:

| Rule             | Shown as           |
| ---------------- | ------------------ |
| `JWT_ASSIGNMENT` | a login token (JWT) |

| Answer                  | What happens |
| ----------------------- | ------------ |
| No, keep it hidden      | The AI gets the message below instead of the output. |
| Yes, show it this once  | The AI sees the full output, secret included. Nothing is saved. |

When you choose "No, keep it hidden", the AI sees:

```
⚠ Output from `bash` was withheld because it may contain sensitive information.

The tool completed successfully, but the output is unavailable.
Continue with the available information, or ask the user to allow access if the output is needed.
```

The session-grant shape from ADR-030 does NOT apply here — every
detection re-prompts. (Follow-up: scope detection grants to a
"trusted output" set the same way paths are trusted.)

---

## 13. Project policy — untrusted widening warning

Trigger: a project has a `.pi/sandbox.json` that adds `*.composio.dev`,
`*.composio.ai` and `*.composio.com` to `network.allowedDomains`. The
project isn't trusted.

This is a notice, not a question — there's nothing to pick:

```
⚠  This project's settings try to loosen your security

    File     ~/code/my-app/.pi/sandbox.json
    Wants    let pi connect to *.composio.dev, *.composio.ai,
             *.composio.com
    Status   ignored — your normal rules still apply

    Did you write this file? Type /security trust to use it.
```

**What goes wrong today:** if you answer "always … in this project" on a
network prompt while this project is untrusted, the rule is written into
the untrusted file, and `recordProjectTrust` records the file's new hash.
That quietly trusts the whole file — including the domains you never
approved (`*.composio.ai`, `*.composio.com`).

**Audit** of the silent trust-via-write:

```jsonl
{"layer":2,"tool":"bash","subject":"backend.composio.dev","decision":"always-cwd","scope":"cwd","persisted_to":"…/.pi/sandbox.json","cwd":"…"}
```

**With the new screen 2** (see §1): in an untrusted project, the "in this
project" rows are hidden and a Note line explains why. Only "in all
projects" rows remain, so nothing can be written into the untrusted file:

```
💾  Always allow connecting — what, and where?

    Site     backend.composio.dev
    Group    *.composio.dev   (every composio.dev site)
    Note     this project isn't trusted — run /security trust to save rules here

  > All in group                in all projects
    Only backend.composio.dev   in all projects

  Default: All in folder · in this project
```

No row is marked (recommended) here: both remaining rows apply to every
project, so it's your call. (This replaces the earlier follow-up: refuse
"always-cwd" at the menu layer when the project is untrusted.)

---

## Summary of the wins

| Scenario                                    | Prompts before ADR-030      | Prompts after |
| ------------------------------------------- | --------------------------- | ------------- |
| `composio search` (2 folders + 2 sites)     | 4+ prompts (one per file)   | 4 prompts (one per folder / site group; more files in the same folder add none) |
| Second `composio search` in same session    | 4+ prompts again            | 0 prompts (session answers still active) |
| `grep -r TOKEN .env` (askRead)              | 1 prompt                    | 1 prompt (no "always" — secrets are never saved) |
| `cat ~/.ssh/id_rsa`                         | 2 screens                   | 1 screen (one read at a time) |
| `cat ~/notes/todo.md` (outside project)     | 1 prompt, no session answer | 1 prompt, now with "Yes, for this session" |
| `curl https://example.com/api`              | 1 prompt + 1 option pick    | 1 prompt + 1 option pick (no change — no group for a bare domain) |
| `curl https://api.composio.dev/v1/...`      | 1 prompt, exact host        | 1 prompt; "all in group" covers **`*.composio.dev`** for the session |

**Net cost:** ~2 wasted turns per CLI call → **0–1 wasted turns**.

---

## Where the friction still lives (not fixed by ADR-030)

1. **Telemetry still prompts.** `us.i.posthog.com` is asked individually.
   ADR-030's `*.i.posthog.com` wildcard helps, but a separate telemetry
   tier ("this is analytics, not core functionality — auto-grant for
   well-known vendors") is a real future ADR.
2. **Untrusted-project widening.** The fix is designed in §13 (screen 2
   hides the "in this project" rows in an untrusted project) but isn't
   built yet.
