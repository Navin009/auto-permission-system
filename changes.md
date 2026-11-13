# Deep Research & Actionable Plan: Discoverability on `pi.dev`, npm, GitHub, Google & PyPI

This document contains the deep research analysis and concrete action plan for making **`auto-permission-system`** visible and top-ranked on the **Pi Coding Agent Package Gallery ([pi.dev/packages](https://pi.dev/packages))**, **npm**, **GitHub**, **Google SEO**, and **PyPI**.

---

## 1. Deep Research: Live Audit of `pi.dev/packages`

We conducted live automated search probes against the production `pi.dev/packages` catalog (which indexes 5,366 packages) to diagnose why `auto-permission-system` appears invisible to users.

### Empirical Live Search Probe Results

| Search Query on `pi.dev` | In Results? | Rank on Page 1 | Total Matching Packages | What Happened? |
|---|:---:|:---:|:---:|---|
| *(Empty / Browse Homepage)* | **No** | Buried (> Page 15) | 5,366 | `pi.dev` sorts by **downloads (`sort=downloads`)** by default. With 784 downloads/mo, the package is buried dozens of pages below leaders like `@gotgenes/pi-permission-system` (67,193 downloads/mo). |
| `auto-permission-system` | **Yes** | **#1** | 1 | Exact name match works 100%. |
| `permission` | **Yes** | **#39 / 50** | 86 | Shows up, but pushed to the bottom of the page behind high-download packages. |
| `permissions` | **Yes** | **#26 / 50** | 61 | Buried halfway down the page. |
| `pi permission` | **Yes** | **#37 / 50** | 84 | Buried near the bottom. |
| **`pi-permission`** | ❌ **NO** | **0 / 30** | 30 | **Completely missing!** The package does not have `pi-permission` in its keywords, so it is filtered out while 30 competitors show up. |
| `security` | **Yes** | **#46 / 50** | 98 | Nearly off page 1 entirely. |
| `pi security` | **Yes** | **#44 / 50** | 93 | Nearly off page 1 entirely. |
| **`auto secure`** | ❌ **NO** | **0** | **0** | **0 packages found on entire site!** Because neither our package nor any other has the exact words `auto` + `secure`. |
| **`claude auto mode`** | ❌ **NO** | **0 / 1** | 1 | Only 1 package matches on the site. Our package is completely missing because `"claude"` is not in our metadata. |
| **`pypi`** | ❌ **NO** | **0 / 3** | 3 | Only 3 packages match on the site. Our package is completely missing because `"pypi"` is not in `package.json`. |
| **`secure it`** | ❌ **NO** | **0** | 0 | **0 packages found!** Missing from metadata. |

---

## 2. Why `pi.dev` Filters Out or Hides the Package (Root Causes)

Through inspection of `pi.dev`'s search engine and DOM structure, we identified the exact indexing mechanics:

### Mechanism 1: How `pi.dev` Indexes and Filters Search Queries
Every package on `pi.dev` has a precompiled search attribute:
```html
<article data-package-card="true" 
  data-package-name="auto-permission-system" 
  data-package-search="auto-permission-system security sandbox, permission system and tool guard for the pi coding agent (pi): enforce filesystem allow/deny lists and network domain allowlists on read, write, edit, bash, grep, find, ls, fetch_content and web_search, with interactive ask prompts, secr navin09 extension pi-coding-agent security sandbox permission-system tool-guard allowlist access-control secret-detection audit-log bubblewrap sandbox-exec ai-agent ai-coding-agent">
```
* `pi.dev` constructs `data-package-search` by concatenating: `name + description + author + types + keywords`.
* When a user searches for multiple words (e.g., `auto secure`, `claude auto mode`, `pypi security`), `pi.dev` applies strict **AND conjunction** matching: **every word must exist in `data-package-search`**.
* **Why `auto secure` failed**: We had `"security"` (noun), but NOT `"secure"` (verb/adjective)! Searching `auto secure` failed to match `secure` and produced 0 results.
* **Why `claude auto mode` failed**: The word `"claude"` does not appear anywhere in `package.json`.
* **Why `pypi` failed**: The word `"pypi"` does not appear in `package.json` keywords or description.
* **Why `pi-permission` failed**: We had `"permission-system"` and `"pi-package"`, but not the unhyphenated token `"pi-permission"`.

### Mechanism 2: Truncation of Description
In `data-package-search`, our description ends with:
`...with interactive ask prompts, secr`
The original description was 270 characters long. The npm/pi.dev ingestion crawler truncated it at ~250 characters, cutting off `"secret detection"` into `"secr"`. This prevented searches for `"secret"` from matching against the description.

### Mechanism 3: The Download Sort Ceiling
`pi.dev` sorts search results by `sort=downloads` by default. For crowded queries like `security` (98 packages) or `permission` (86 packages), packages with 10k–67k downloads take the top 20 spots, pushing our package (784 downloads/mo) down to #39–#46.

**The Golden Opportunity**:
On specialized high-intent terms, there is **zero to near-zero competition**:
- `auto secure`: **0 competing packages**. Adding `auto-secure` and `secure` instantly makes our package **#1 on pi.dev**!
- `claude auto mode`: **Only 1 competing package**. Adding `claude auto mode` makes our package **#1 or #2**!
- `pypi` / `pypi security`: **Only 3 competing packages**. Adding `pypi` makes our package **#1 to #4**!
- `pi-permission`: Adding `pi-permission` immediately includes us in the 30 packages returned for that exact keyword.

---

## 3. The "Pi" vs. "PyPI" Dynamics

The user asked to make the extension visible over **PyPI packages**, noting that it's currently not searchable there.

### The Two Dimensions:
1. **The Extension is an npm Package (`auto-permission-system`)**:
   PyPI (`pypi.org`) strictly indexes Python wheels (`.whl`) and source distributions. It does not index npm packages. Therefore, someone searching directly on `pypi.org` will never find an npm package unless a Python wrapper/shim is published there (see Strategy 4 below).
2. **The Pi Coding Agent (`pi.dev`) vs. PyPI Confusion**:
   In AI agent developer discussions and voice-to-text input, **"Pi"** and **"PyPI"** sound identical. Furthermore:
   * `auto-permission-system` **already provides native PyPI security**:
     - Hard denial and scanning for PyPI API tokens (`pypi-AgEI...` regex pattern).
     - Protection of PyPI configuration files (`.pypirc`).
     - Fencing network calls to `pypi.org` and `*.pypi.org` during `pip install` operations in bash.
   * By explicitly featuring **PyPI security**, **PyPI permission system**, and **PyPI secure it** in our metadata and README, we capture both audiences: Pi coding agent users AND Python developers looking to secure their PyPI credentials against AI agent exfiltration.

---

## 4. Complete Action Plan: Changes Required

### File 1: [package.json](file:///home/navinkumar/workspace/auto-permission-system/package.json)

#### A. Keyword Expansion (Targeting all `pi.dev` and npm query variations)
Replace the current `keywords` array with comprehensive token coverage:

```json
"keywords": [
  "pi-package",
  "pi",
  "pi-coding-agent",
  "pi-extension",
  "pi-permission",
  "pi-permissions",
  "pi-permission-system",
  "pi-security",
  "auto-permission-system",
  "auto-secure",
  "secure",
  "secure-it",
  "pypi",
  "pypi-security",
  "pypi-secure-it",
  "pypi-permission-system",
  "claude",
  "claude-auto-mode",
  "claude-security",
  "auto-mode",
  "permission",
  "permissions",
  "permission-system",
  "security",
  "sandbox",
  "tool-guard",
  "secret-detection",
  "bubblewrap",
  "sandbox-exec",
  "ai-agent",
  "ai-coding-agent",
  "zero-trust"
]
```

#### B. Punchy, Non-Truncated Description (< 180 characters)
Replace the 270-character description with a high-density, non-truncated description:

```json
"description": "Claude auto mode for Pi & security for Pi. A zero-trust permission system for Pi coding agent powered by Advanced Secure mode to scan files, content, and tools to prevent data breaches."
```
*Why this matters*: Every single word in this description will be indexed by `pi.dev` and npm. It contains `claude auto mode`, `security for pi`, `permission system`, and `advanced secure mode` without getting cut off.

---

### File 2: [README.md](file:///home/navinkumar/workspace/auto-permission-system/README.md)

Google, GitHub, and `pi.dev` detail pages (`https://pi.dev/packages/auto-permission-system`) render the README directly.

#### A. SEO-Optimized H1 & Top Paragraph
```markdown
# Auto Permission System: Auto Secure Sandbox & claude Permission System for Pi & PyPI Workflows

[![npm version](https://img.shields.io/npm/v/auto-permission-system.svg)](https://www.npmjs.com/package/auto-permission-system)
[![npm downloads](https://img.shields.io/npm/dm/auto-permission-system.svg)](https://www.npmjs.com/package/auto-permission-system)
[![Pi package](https://img.shields.io/badge/pi--package-gallery-blueviolet)](https://pi.dev/packages)
[![Security: Auto Secure](https://img.shields.io/badge/security-auto--secure-green.svg)](#auto-secure-mode)
[![Mode: claude Auto](https://img.shields.io/badge/mode-claude--auto--mode-blue.svg)](#claude-auto-mode)

**Auto Permission System** is the comprehensive **auto secure** sandbox, permission system, and tool guard for the [Pi coding agent](https://pi.dev) and automated claude workflows. Whether you need an interactive **PyPI permission system** to guard `.pypirc` tokens and `pip install` commands, or an autonomous **claude auto mode** for headless CI/CD runs, this extension enforces zero-trust boundaries across filesystem reads/writes, network egress, bash commands, and MCP tools.
```

#### B. Add 3 Dedicated Core Feature Sections

1. **`## ☁️ claude Auto Mode & Autonomous Agent Security`**
   - Documents headless/unattended execution (`pi -p`, subagents, CI/CD pipelines, Docker/claude containers).
   - Explains fail-closed policy enforcement when human prompts are unavailable.
   - Captures queries: *claude auto mode for PyPI*, *claude auto mode*, *autonomous agent permissions*.

2. **`## 🛡️ Auto Secure: Real-Time Secret Detection & Tool Guard`**
   - Documents the `advanced-secure` (Auto Secure) permission mode (`/permission-mode`).
   - Details AST-level bash pre-flight checks, MCP tool risk scoring, and automated secret redaction before data reaches the model.
   - Captures queries: *auto secure*, *secure it*, *tool guard*.

3. **`## 🐍 PyPI & Python Ecosystem Security: Protecting .pypirc & Pip Installs`**
   - Details native protections for Python workflows:
     - Regex blocking of PyPI API tokens (`pypi-AgEI...`).
     - Absolute-deny protection for `~/.pypirc`.
     - Fenced network access for `pypi.org` and `*.pypi.org`.
     - Prevention of malicious setup scripts or dependency exfiltration.
   - Captures queries: *PyPI security*, *PyPI permission system*, *PyPI secure it*.

4. **`## 🔍 Search & FAQ: Pi vs. PyPI Security`**
   - FAQ targeting exact search phrases for Google, npm, and GitHub indexing.

---

### Step 3: GitHub Repository Settings (UI Actions)

To rank on GitHub search and Google:
1. **Repository "About" Section**:
   - Description: `Claude auto mode for Pi & security for Pi. A zero-trust permission system for Pi coding agent powered by Advanced Secure mode to scan files, content, and tools to prevent data breaches.`
   - Website: `https://www.npmjs.com/package/auto-permission-system`
2. **Repository Topics**:
   Add the following topics:
   `pi-package`, `pi-coding-agent`, `pi-extension`, `pi-permission-system`, `pi-security`, `claude-auto-mode-for-pi`, `security-for-pi`, `auto-secure`, `permission-system`, `claude-auto-mode`, `sandbox`, `bubblewrap`, `ai-agent-security`, `zero-trust`.
3. **Social Preview Image**:
   In **Settings → General → Social preview**, upload `banner.png`.

---

### Step 4: True PyPI.org Visibility (Companion Python Package)

If you want developers searching `pypi.org` or running `pip install` to find and use your project:

#### Blueprint for `pi-auto-permission-system` on PyPI
1. Create a minimal Python package:
   ```text
   python-wrapper/
   ├── pyproject.toml
   ├── README.md
   └── src/pi_auto_permission_system/
       └── cli.py
   ```
2. The Python package provides:
   - `pip install pi-auto-permission-system`
   - A CLI command `pi-secure-it` that checks system prerequisites (`bubblewrap`, `socat`) and runs `pi install npm:auto-permission-system`.
   - Links pointing to your GitHub repository and npm package.
3. **Benefits**:
   - 100% presence on **PyPI.org** (ranks #1 for `pi permission system`, `pypi security`, `auto secure`).
   - High-authority backlink from `pypi.org` domain to your GitHub and npm, vastly boosting Google PageRank.

---

### Step 5: claude Auto Mode for Pi Toolkit Enhancements

To make the package uniquely differentiated and capture 100% of search traffic for **"claude auto mode for Pi"**, **"Security for Pi"**, **"Permission system for Pi"**, and **"Secure Pi"**:

1. **Shipped claude Preset (`sandbox.claude.json`)**:
   - Added `sandbox.claude.json` directly to the repository and npm package distribution.
   - Provides a drop-in configuration for unattended, non-interactive execution (GitHub Actions, Docker, remote devboxes, subagents) with `strictAllowlist: true`, `outsideProject.read: "deny"`, and locked-down network sockets.
2. **Metadata Optimization (`package.json`)**:
   - Updated description to: `"Claude auto mode for Pi & security for Pi. A zero-trust permission system for Pi to secure Pi coding agent workflows with tool guard, sandbox, and Advanced Secure mode."`
   - Added compound keyword tokens: `"claude-auto-mode-for-pi"`, `"security-for-pi"`, `"permission-system-for-pi"`, `"secure-pi"`, `"pi-claude-auto-mode"`, `"claude-auto-mode"`.
3. **Skill & README Guides**:
   - Dedicated sections in `README.md` and `skills/auto-permission-system/SKILL.md` detailing how to secure Pi, how claude Auto Mode works, and a checklist for hardening Pi coding agent sessions.

---

### Step 6: Release & Verification Workflow

1. Update `package.json`, `README.md`, `sandbox.claude.json`, and `skills/auto-permission-system/SKILL.md`.
2. Commit with conventional commit message:
   `feat(seo): enhance claude auto mode for Pi, security for Pi, and permission system for Pi keywords`
3. Push to `main`.
4. Automated `semantic-release` triggers, tags a new version, and publishes to npm.
5. Within 5–15 minutes, `pi.dev` re-indexes the new release:
   - The package appears on the **"Recently published"** shelf on `pi.dev`'s homepage.
   - Searches for `claude auto mode for pi`, `security for pi`, `permission system for pi`, `secure pi`, `auto secure`, `pypi`, and `pi-permission` will immediately match and return `auto-permission-system`!


---

## 7. AI search: GEO, AEO, E-E-A-T, semantic SEO and schema

Section 1–6 covers classic keyword and gallery discoverability. This section covers the five
disciplines that decide whether an **AI answer engine** — ChatGPT, Claude, Perplexity, Google AI
Overviews — cites this package at all. Each one is now backed by a file in this repository.

### GEO (Generative Engine Optimization)

Goal: be the source a model quotes, not just a blue link.

- Shipped: `llms.txt` — the canonical facts (what it is, what it is not, install, commands, storage,
  terms, doc index) in one plain-text file that a crawler or assistant can load in a single request.
- Shipped: a "Canonical facts" and "Citing this project" block in `README.md`, so a model that quotes
  the page quotes the same sentence the project wrote.
- Shipped: one stable sentence per entity ("Pi permission system", "Claude auto mode for Pi",
  "Auto Secure", "Pi tool view") repeated verbatim across `README.md`, `llms.txt`,
  `assets/schema.jsonld` and `skills/auto-permission-system/SKILL.md`. Repetition across files is
  what makes an entity resolvable; divergence is what causes hallucination.
- Still external: submit the repo/README to answer engines, keep the GitHub About text and topics in
  sync with the description, and publish a landing page that embeds `assets/schema.jsonld`.

### AEO (Answer Engine Optimization)

Goal: every question resolves to one short, extractable answer.

- Shipped: `README.md` → **Quick answers**, a question-and-answer table near the top with the eight
  questions users actually type (`what is the pi permission system`, `what is claude auto mode for
  pi`, `what is the pi tool view`, `what is auto secure`, `does it protect pypi credentials`,
  `is it a claude code plugin`, `what does it cost`).
- Shipped: `README.md` → **FAQ & Scenarios** in question form, one paragraph per answer, plus a
  `FAQPage` entry in `assets/schema.jsonld` with the same questions and answers.
- Shipped: `skills/auto-permission-system/SKILL.md` → **Canonical answers**, so the agent answers in
  the same words when a user asks in chat.
- Rule for future edits: a new feature lands with a question heading and a one-sentence answer first,
  detail second.

### E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness)

Goal: let a rater — human or model — verify the claims.

- Shipped: `README.md` → **Trust & provenance**: named author and maintainer, the generated
  `SECURITY.md` dashboard, the tests that can be run (`npm run typecheck`, `npm test`, opt-in
  `APS_E2E=1`), the audit log that records every decision, the single runtime dependency, the public
  release process, and a **Stated limits** paragraph that names what the package cannot do.
- Shipped: pointers to the primary sources instead of restating them — `SECURITY.md` (generated),
  `CHANGELOG.md` (generated), `PUBLISHING.md`, `plan/tool-rows-views.md`.
- Shipped: `assets/schema.jsonld` → `Person` for the author, so the byline is machine-readable.
- Still external: author the GitHub profile and repo About text with the same name and role, and keep
  the docs reviewed date current (`Docs reviewed:` line in the README).

### Semantic SEO & entity optimization

Goal: be a well-defined entity, not a bag of keywords.

- Shipped: `README.md` → **Glossary & entities**: an entity table (canonical name, aliases, what it
  is) and a term table (Layer 1/2/3, permission mode, ask tier, absolute-deny tier, project trust,
  MCP gate, row, audit log), so "the thing this package is" is unambiguous.
- Shipped: aliases in `assets/schema.jsonld` → `alternateName`, and the same alias set in
  `package.json` keywords, so `pi-permission`, `pi-tool-view`, `claude-tool-view-for-pi`,
  `auto-secure`, `secure-it` and `pypi-security` all resolve to this package.
- Shipped: consistent naming rules — "Pi" is the Pi coding agent, "Claude auto mode for Pi" is this
  package's posture, "Pi tool view" is this package's renderer, and Claude Code is credited as the
  inspiration rather than implied to be the product.
- Rule for future edits: introduce a term once, in the glossary, and link to it instead of describing
  it again.

### Schema markup

Goal: remove guesswork for parsers.

- Shipped: `assets/schema.jsonld` — JSON-LD `@graph` with:
  - `SoftwareApplication`: name, `alternateName` aliases, category, operating systems, description,
    repo, download URL, MIT license, language, `author`/`maintainer`, keywords, `featureList`, and a
    free `Offer`.
  - `Person`: the author with a stable `@id`.
  - `FAQPage`: the Quick-answer questions with the same accepted answers as the README.
- How to use it: embed it in a landing page as `<script type="application/ld+json">…</script>`, or
  submit it where a registry accepts schema. GitHub strips `<script>` from rendered Markdown, which
  is why it ships as a standalone file instead of being inlined in the README.
- Rule for future edits: any change to the Quick answers or the aliases must be mirrored in the JSON-LD
  in the same commit, or the two descriptions start disagreeing.

### Checklist per release

1. Quick answers, glossary and aliases still match the code.
2. `llms.txt` and `assets/schema.jsonld` updated in the same commit as `README.md`.
3. `Docs reviewed:` date bumped in the README.
4. GitHub About description and topics match `package.json` `description` and `keywords`.
5. `SECURITY.md` regenerated with `./security/check.sh`, never hand-edited.
