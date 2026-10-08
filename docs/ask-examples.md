# Ask-tier prompt examples (after ADR-030)

Every block triggers one or two `ui.select` prompts. This file shows both
screens verbatim, for every gate the system has, with realistic scenarios.
Use it to:

- See what the user actually sees on screen.
- Find places where wording is still ambiguous or still asks too often.

Conventions:

- **`>`** marks the preselected (Enter-applies) option in each screen.
- **`↑/↓`** notes assume the user is using arrow keys to navigate; today's
  selector still times out after `ASK_TIMEOUT_MS` (default 10s).
- Folder / sample values are real-world examples taken from the audit log.

---

## 1. Write — `~/.composio/tool_definitions/x.json`

Trigger: `composio search googleads` tries to create a tool file under its
cache. Layer 1 fences the bash command, the sandbox prints `EROFS:
read-only file system, open '/home/u/.composio/tool_definitions/x.json'`,
the write hook takes over.

### Screen 1 — verdict + duration

```
🛡 Write blocked by policy
   file:   /home/u/.composio/tool_definitions/x.json
   folder: /home/u/.composio/tool_definitions/   (covers every file under it)
   why:    not under any allowWrite root

  > Block (default)
    Allow once
    Allow this folder for this session
    Allow and remember…
```

→ `Allow once` re-runs the command, allows the parent folder only for this
invocation (ADR-021). Never saved.

→ `Allow this folder for this session` grants `/home/u/.composio/tool_definitions/`
in memory for the rest of the session — every future file under that
folder is allowed without re-prompting (ADR-030).

### Screen 2 — only after "Allow and remember…"

```
Remember this <path>?
   file:   /home/u/.composio/tool_definitions/x.json
   folder: /home/u/.composio/tool_definitions/

  > Allow for this folder (/home/u/.composio/tool_definitions/) - Scope this project
    Allow for this file (/home/u/.composio/tool_definitions/x.json) - Scope this project
    Allow for this folder (/home/u/.composio/tool_definitions/) - Scope global
    Allow for this file (/home/u/.composio/tool_definitions/x.json) - Scope global
```

→ Folder is preselected (ADR-030). Enter grants the folder in the current
project's `.pi/sandbox.json`. Project must be trusted (ADR-013) — otherwise
the write silently fails and the model sees a refusal. Use ↑ ↓ to narrow
back to the file or widen to global.

**Audit:**

```jsonl
{"layer":1,"tool":"bash","subject":"/home/u/.composio/tool_definitions/x.json","decision":"once","scope":"invocation","note":"write-once","cwd":"…"}
{"layer":1,"tool":"bash","subject":"/home/u/.composio/tool_definitions","decision":"always-cwd","granularity":"folder","scope":"cwd","persisted_to":"…/.pi/sandbox.json","cwd":"…"}
```

---

## 2. Write — multi-file invocation, second file

Trigger: same `composio search` writes `user_data.json` next. After the
session grant from §1, this fires **no prompt**.

**Audit** (silent allow via session grant):

```jsonl
{"layer":1,"tool":"bash","subject":"/home/u/.composio/user_data.json","decision":"write-once","cwd":"…"}
```

This is the win the user wanted: one decision for the whole folder, every
subsequent file under it is silent.

---

## 3. Write — folder is unsafe (e.g. `/etc`)

Trigger: a bad command tries `sudo tee /etc/foo`. `isSafeFolderGrant` rejects
the parent (`/`), so the session grant falls back to the file.

### Screen 1 — same shape as §1

```
🛡 Write blocked by policy
   file:   /etc/foo
   folder: /              ← suppressed: not a safe grant target
   why:    not under any allowWrite root

  > Block (default)
    Allow once
    Allow this folder for this session       ← still offered, but selecting it falls back to the file
    Allow and remember…
```

### Session grant value when "this folder" is chosen

`/etc` → `parent = /`, `isSafeFolderGrant('/', home) === false` →
**sessionGrants.push({ kind: 'allowWrite', value: '/etc/foo' })** (file, not
folder). The user sees the same fallback in the audit:

```jsonl
{"layer":1,"tool":"bash","subject":"/etc/foo","decision":"session","grant":"/etc/foo","note":"folder-unsafe","cwd":"…"}
```

(`note: "folder-unsafe"` is a follow-up; today the audit shows the file grant
without the note.)

---

## 4. Read — `.env` (`askRead`, ADR-019)

Trigger: `grep -r TOKEN .env` matches an `.env` line. The pre-flight ask
fires before the command runs.

### Screen 1 (only `once` and `session`; no remember)

```
🛡 Sensitive file read
   file:   /home/u/project/.env
   why:    it may hold secrets

  > Block (default)
    Allow once
    Allow for this session
```

The "remember" option is suppressed here — secrets should not be persisted
to a sandbox.json. `askRead` only ever prompts.

---

## 5. Read — outside the project (`outsideProject.read = "ask"`)

Trigger: `cat ~/notes/todo.md` from inside a project. The pre-flight detects
the outside path before sandbox-exec fences it.

### Screen 1

```
🛡 Read outside the project
   path:   /home/u/notes/todo.md
   source: this bash command

  > Block (default)
    Allow once
    Allow and remember…
```

(No `Allow for this session` for outside reads — only once and remember.
Rationale: session grants are for cache writes that recur inside a session,
not for one-off reads.)

### Screen 2

```
Remember this read?
   file:   /home/u/notes/todo.md
   folder: /home/u/notes/        ← only if isSafeFolderGrant

  > Allow for this folder (/home/u/notes/) - Scope this project
    Allow for this file (/home/u/notes/todo.md) - Scope this project
    Allow for this folder (/home/u/notes/) - Scope global
    Allow for this file (/home/u/notes/todo.md) - Scope global
```

If the path is `~/notes/todo.md` (a file directly in home), `parent =
/home/u` → `isSafeFolderGrant(/home/u, /home/u) === false` → only the
exact file is offered.

---

## 6. Read — `~/.ssh/id_rsa` (absolute deny)

Trigger: `cat ~/.ssh/id_rsa`. Two deliberate steps (ADR-009) — both
default to block, so Enter-Enter can never approve.

### Screen 1 — credential banner

```
⚠  Credential access blocked
   file:  /home/u/.ssh/id_rsa
   why:   denyRead matched "~/.ssh"

   > Block (default)
     Allow this one call
```

### Screen 2 — explicit confirm

```
Confirm: allow one read of credential material?

   > No — keep blocked (default)
     Yes — allow once
```

No "Allow for this session". No "Allow and remember…". The credential tier
is intentionally a one-shot.

**Audit:**

```jsonl
{"layer":2,"tool":"read","subject":"/home/u/.ssh/id_rsa","reason":"denyRead matched \"~/.ssh\"","decision":"yes","cwd":"…"}
```

(Headless mode would have logged `decision: "no"`.)

---

## 7. Network — `backend.composio.dev` (3-part host)

Trigger: bash spawns `curl https://backend.composio.dev/v1/...`. The
sandbox-runtime proxy asks the host before connecting.

### Screen 1 — allow-first (ADR-024)

```
🛡 Network access blocked
   host:  backend.composio.dev
   group: *.composio.dev    (covers all subdomains)
   why:   not in the allowlist

   > Allow (default)
     Deny
     Allow this host group for this session
     Allow and remember…
```

The preselected option is **Allow** (ADR-024). An unanswered 10s countdown
still allows the bash command's connection; Esc denies. The session label
calls out the grant: `*.composio.dev`.

→ `Allow once` covers this command's connections to `backend.composio.dev`.
Future connections in the same command hit the same `commandGrants` set
without re-prompting (ADR-023).

→ `Allow this host group for this session` stores `*.composio.dev` in
memory. Next composio invocation connecting to `api.compos.io`,
`metrics.compos.io`, etc. all pass without a prompt.

### Screen 2 — wildcard first (ADR-030)

```
Remember this host?
   host: backend.composio.dev

   > Allow *.composio.dev (covers all subdomains) - Scope this project
     Allow this host (backend.composio.dev) - Scope this project
     Allow *.composio.dev (covers all subdomains) - Scope global
     Allow this host (backend.composio.dev) - Scope global
```

`picked.pattern` is the value persisted into `overrides.allowDomains` and
applied live to the running proxy. Audit shows both the pattern that was
granted and the host that prompted:

```jsonl
{"layer":1,"tool":"network","subject":"backend.composio.dev","decision":"always-cwd","scope":"cwd","persisted_to":"…/.pi/sandbox.json","pattern":"*.composio.dev","requested":"backend.composio.dev","cwd":"…"}
```

---

## 8. Network — `us.i.posthog.com` (telemetry)

Same shape as §7. The wildcard is `*.i.posthog.com`, which covers
`us.i.posthog.com`, `eu.i.posthog.com`, etc.

### Audit (session grant):

```jsonl
{"layer":1,"tool":"network","subject":"us.i.posthog.com","decision":"session","grant":"*.i.posthog.com","requested":"us.i.posthog.com","cwd":"…"}
```

(The `i.posthog.com` wildcard is intentionally narrow — it does NOT cover
`posthog.com`'s other products like `app.posthog.com` or
`us.posthog.com`. If the user wants the entire vendor, they pick the exact
host on screen 2.)

---

## 9. Network — `example.com` (2-part apex)

Trigger: a curl to `https://example.com/api`. No useful subdomain
wildcard — `*.example.com` wouldn't match the apex.

### Screen 1

```
🛡 Network access blocked
   host:  example.com
   why:   not in the allowlist

   > Allow (default)
     Deny
     Allow this host group for this session
     Allow and remember…
```

(No `group:` line in the body — the system detected no useful wildcard.)

### Screen 2 — only 2 (no wildcard option)

```
Remember this host?
   host: example.com

   > Allow this host (example.com) - Scope this project
     Allow this host (example.com) - Scope global
```

The session grant for `example.com` is the exact host — the wildcard
generation returns `host` for 2-part hosts.

---

## 10. Sensitive command — `env | grep COMPOSIO`

Trigger: bash runs `env | grep -i composio`. `commands.ask` lists
`^env$`, `^printenv$`, `/proc/[^/]+/environ` — bare invocation only.

### Screen 1

```
🛡 Command may print secrets
   command: env
   why:     it can print environment values (API tokens)

   > Block (default)
     Allow once
```

(No session, no remember — these commands print too much to grant
broadly.)

The pre-flight runs before the sandbox-exec child starts. If denied, the
command never runs:

```
❌ pi-sandbox: command blocked — it can print secrets: env. Nothing was run — ask the user.
```

---

## 11. Advanced Secure — sensitive file (`mcp.json`)

Trigger: Layer 2 reads `~/.pi/agent/mcp.json`. The file is in
`denyRead` AND `askRead`, AND Advanced Secure flags it as
`strong`-risk for credential names.

```
🛡 Read blocked — sensitive file
   file: /home/u/.pi/agent/mcp.json
   why: matches denyRead and contains credential-like content

  > Block (default)
    Allow this one call
    Allow for this session (not saved)
```

If the model ignores the read and tries to use the contents from another
tool (e.g. `grep`), Layer 2's `tool_result` filter drops the matched lines
before they reach the model.

---

## 12. Advanced Secure — output gate (redaction prompt)

Trigger: a tool returned output that contains a `JWT_…` token. The output
filter detected it before the model saw it.

```
⚠ Sensitive information detected

   output from: bash
   matched: JWT_ASSIGNMENT on line 14
              14: export JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

   > No, keep private
     Yes, allow
```

Choosing "Yes, allow" passes the real value through. Choosing "No, keep
private" withholds the output and the model sees:

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

Trigger: a project has a `.pi/sandbox.json` that adds
`*.composio.dev` to `network.allowedDomains`. The project isn't trusted.

```
⚠  This folder has a .pi/sandbox.json that tries to make your security weaker:
   • Let pi connect to: *.composio.dev, *.composio.ai, *.composio.com.
   auto-permission-system ignores these changes. Its block rules still apply.
   Did you write this file? Then type /security trust.
```

If the user picks "Yes — allow this once" inside a `composio` session, the
grant is written to the **untrusted** project file. The write does persist,
and `recordProjectTrust` records the new hash — so the project's widening
becomes effective *for that specific file change*, but the user is
surprised because the warning still appears on the next session_start
since the file was modified again.

**Audit** of the silent trust-via-write:

```jsonl
{"layer":2,"tool":"bash","subject":"backend.composio.dev","decision":"always-cwd","scope":"cwd","persisted_to":"…/.pi/sandbox.json","cwd":"…"}
```

(Not in this PR. Follow-up: refuse the "always-cwd" option at the menu layer
when the project is untrusted, redirect to `/security trust` or
"global scope".)

---

## Summary of the wins

| Scenario                                    | Prompts before ADR-030 | Prompts after |
| ------------------------------------------- | ---------------------- | ------------- |
| `composio search` (write + 2 networks)      | 4 prompts              | 3 prompts (session covers whole folder + whole vendor) |
| Second `composio search` in same session    | 4 prompts again        | 0 prompts (session grant active) |
| `cat .env` (askRead)                        | 1 prompt               | 1 prompt (no change — secrets stay one-shot) |
| `cat ~/.ssh/id_rsa`                         | 2 prompts              | 2 prompts (no change — absolute deny stays) |
| `curl https://example.com/api`              | 1 prompt + 1 option pick | 1 prompt, 1 option pick (no change — apex host) |
| `curl https://api.composio.dev/v1/...`      | 1 prompt, exact host  | 1 prompt, **`*.composio.dev`** (covers the whole vendor for the session) |

**Net cost:** ~2 wasted turns per CLI call → **0–1 wasted turns**.

---

## Where the friction still lives (not fixed by ADR-030)

1. **Telemetry still prompts.** `us.i.posthog.com` is asked individually.
   ADR-030's `*.i.posthog.com` wildcard helps, but a separate telemetry
   tier ("this is analytics, not core functionality — auto-grant for
   well-known vendors") is a real future ADR.
2. **Untrusted-project widening is still confusing.** §13 above.
4. **No activity extension on the timer.** The 10s countdown still
   applies; pressing ↑/↓ doesn't pause it. ADR-030 added the
   `ASK_TIMEOUT_BY_ACTION` constant but didn't yet wire `onTerminalInput`
   to extend. (Follow-up.)
5. **Advanced Secure re-prompts every detection.** No session grant for
   output yet.