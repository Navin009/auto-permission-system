# ADR-018: Permission modes and the Advanced Secure detector

**Status:** Accepted

## Context

Both layers are rule-based: they decide on paths, domains, and command names.
Rules cannot see *content*. Three exposure vectors were outside them:

1. **File reads** — `read` of a file that is not on a deny list but holds a
   hardcoded key, token, or password.
2. **MCP tool calls** — a server tool with a destructive or mutating name runs
   with no risk check at all.
3. **Tool/command/file output** — a command can print a secret that then goes
   straight to the model. The only output control today is the grep line filter.

The `read-sensitive-detection` project already builds three pure cores for
exactly these (filename gate + content scanner, MCP gate, output scanner). They
return `decision: "allow" | "ask"` with a risk score, which matches the existing
gate vocabulary.

## Decision

- **One mode field.** `sandbox.json` gains a top-level `"mode"`:
  `"default"` (rules only, the shipped value) or `"advanced-secure"`. It is
  layered like every other key: `sandbox.default.json` < global < project
  (ADR-016).
- **Detection is additive.** Advanced Secure may only ADD asks or redactions.
  It never downgrades a rule: if the path policy blocks a read, the detector
  never unblocks it.
- **Vendored, not depended on.** The four pure cores are copied into
  `src/detect/` (CLIs and benchmarks dropped) so the package stays
  self-contained. `security/tests/unit/detect-smoke.mjs` locks their behavior.
- **A third entrypoint owns the UI.** `extensions/permission-mode.ts` owns the
  footer status, `/permission-mode`, and the Shift+S shortcut. It enforces
  nothing. Because the two layer entrypoints share no memory, the choice is
  **persisted** to the global `~/.pi/agent/extensions/sandbox.json`; Layer 2
  sees it at once, Layer 1 on its next `session_start`.
- **What Advanced Secure does (v1):**
  - `read` — `classifyFilename` on the path; a `strong` verdict asks before the
    read.
  - `mcp__*` — `evaluateMcpCall` with the tool's description, schema, and
    annotations from `pi.getAllTools()`; an `ask` verdict prompts.
  - `tool_result` for every tool — `scanToolOutput`; a hit prompts the user
    **before** the output reaches the model (`⚠ Private content found`, the
    finding types, the line(s) where it was found, then `Should the AI
    be allowed to see it?` with `No, keep private` / `Yes, allow`). No, keep
    private withholds it and returns an explicit notice (never empty, never
    phrased as a failure), so the model treats it as a deliberate user block,
    not a broken tool; Yes, allow passes the real values through. Esc / timeout
    keeps it private. Headless (no UI) keeps it private.
  - **`key` is a weak key.** A bare `key` is too generic to flag on its own
    (`key=value` is ordinary config), but it counts when the value is not a
    placeholder and looks random — so `key=<random secret>` asks while
    `key=value`, `key=somevalue`, and repeats like `key=aaaaaaaa` stay clean.
    Stronger names (`api_key`, `secret`, `token`, …) keep the stricter value
    rule. This is a local tuning of the vendored scanner.
- **No "remember" yet.** Detection asks offer `Block (default)` / `Allow once` /
  `Allow for this session`. Session grants are in memory only.
- **Trust still governs loosening.** `applyUntrustedProject` treats `mode` as an
  ordered ladder: an untrusted project may opt IN to `advanced-secure`, never
  out of it.

## Consequences

- A detected secret in output is never sent silently: the user sees a warning
  naming the file and each detected line as `lineNo: text`, and
  chooses `Yes, allow` or `No, keep private`. On `No, keep private`, the model
  receives a clear withheld notice instead of the values.
- False positives exist by design (the cores are conservative). The mode is
  opt-in and can be switched off from the footer or `/permission-mode`.
- The output scanner runs on every tool result in this mode. The cores cap their
  work (64 KiB default, 256 KiB hard) and skip larger payloads.
- `Shift+S` is display-only advice: a bare shifted letter reaches a terminal as
  `"S"` on some setups. A modifier combo is more reliable; the shortcut is
  registered as `shift+s` regardless.
- Layer 1 does not run the detectors. Bash output is still covered, because it
  arrives as a `bash` tool result and the output gate runs on every tool.

## Follow-ups

- Mask credential env vars via sandbox-runtime `credentials.envVars`
  (`*_KEY` / `*_TOKEN` / `*_SECRET`) so `printenv` shows sentinels — belt and
  suspenders to the `commands.ask` gate (ADR-017).
- Offer "remember" for detection asks (a new override kind).
- Live cross-layer mode sync without waiting for the next `session_start`.
