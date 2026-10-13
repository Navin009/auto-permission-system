# Auto-Permission System: Architecture Analysis & Streamlining Plan

**Date:** October 12, 2026  
**Target:** `auto-permission-system` (Pi Coding Agent Extension)  
**Status:** Comprehensive Analysis & Implementation Proposal  

---

## 1. Executive Summary

The `auto-permission-system` is a two-layer security sandbox and tool guard designed for the Pi coding agent:
- **Layer 1 (OS Sandbox):** Uses `@anthropic-ai/sandbox-runtime` (`bubblewrap` on Linux, `sandbox-exec` on macOS) to enforce filesystem read/write boundaries and network domain allowlists on bash processes.
- **Layer 2 (In-Process Guard):** Intercepts internal agent tools (`read`, `grep`, `find`, `write`, `edit`, `fetch_content`, `mcp__*`) and inspects tool outputs via secret/token detection in `advanced-secure` mode.

### The Core Problem
The current design prioritizes a **"fail-closed, prompt-everything"** posture. While secure against adversarial code, it creates severe friction during autonomous development workflows:

1. **Unattended Deadlocks:** When an agent is working while the user is reading or multitasking, prompts for outside-project reads, sensitive commands, or file writes display a 15-second countdown that **defaults to Deny (`Block`)**. Once expired, the command aborts with an error, halting the agent's autonomous workflow.
2. **Harmless CLI Over-Prompting:** Standard developer tools (`git status`, `cat /etc/os-release`, `which python`, `npm test`, compiler checks) are subjected to strict pre-flight checks or write denials because they touch files outside the project root or write to standard tool cache directories (`~/.cache`, `~/.npm`, `~/.cargo`).
3. **Docker Execution Blocked without YOLO:** Docker CLI fails completely inside the Layer 1 sandbox on Linux because `sandbox-runtime` applies a Seccomp BPF filter that blocks **all `socket(AF_UNIX)` syscalls** by default, preventing communication with `/var/run/docker.sock`. Furthermore, `~/.docker` is blocked from write operations, and Docker registries are omitted from network allowlists.
4. **Under-leveraged Output Scanner:** The system possesses an intelligent, multi-strategy secret and token leak detector (`tool-output-scanner`). However, instead of using this output scanner as an autonomous safety net that allows commands to execute and sanitizes outputs, the system redundantly blocks commands *before* execution and abruptly withholds outputs larger than 64 KiB (`OUTPUT_TOO_LARGE`).

### Proposed Solution: The Autonomous Developer Architecture
1. **Tri-Tier Command Engine:** Categorize commands into **Safe/Harmless** (Instant Auto-Allow), **Benign CLI** (Default-Allow on timeout, mirroring ADR-024), and **Dangerous/Harmful** (Strict Default-Deny).
2. **Developer Cache Whitelist:** Re-allow standard tool caching roots (`~/.cache`, `~/.npm`, `~/.cargo`, `~/.docker`, `/tmp`) in default `allowWrite`.
3. **First-Class Docker Support:** Enable `allowAllUnixSockets`, mount the Docker socket, permit `~/.docker` writes, and allow Docker registry domains.
4. **Output Scanner "Redact-and-Forward":** Automatically mask detected secrets instead of withholding the entire output and stopping the agent. Raise the 64 KiB scan ceiling.
5. **New `autonomous` Permission Mode:** Offer a pre-tuned mode balancing zero-interruption execution with strict data/credential guarantees.

---

## 2. Deep-Dive Architecture & Friction Map

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Agent Invokes Bash / CLI Tool                         │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
┌──────────────────────────────────────┐     ┌────────────────────────────────────┐
│      Layer 1: Pre-flight Checks      │     │     Layer 2: In-Process Guards     │
│   (Sensitive commands, .env reads,   │     │ (read, grep, find, write, edit,    │
│     outside-project path reads)      │     │      fetch_content, MCP tools)     │
└───────────────────┬──────────────────┘     └──────────────────┬─────────────────┘
                    │                                           │
                    ▼                                           ▼
┌──────────────────────────────────────┐     ┌────────────────────────────────────┐
│   Current Behavior: 15s Timeout      │     │  MCP Risk Verbs / Filename Gates   │
│         ──▶ DEFAULT: BLOCK           │     │         ──▶ DEFAULT: BLOCK         │
│ (Unattended agent halted immediately)│     │ (Unattended agent halted immediately)
└───────────────────┬──────────────────┘     └──────────────────┬─────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│               Execution Phase: Bubblewrap / Sandbox-Exec                        │
│  - Blocks AF_UNIX sockets via Seccomp (Breaks Docker CLI)                       │
│  - Blocks writes to ~/.cache, ~/.cargo, ~/.docker (Returns EROFS)               │
│  - Intercepts network egress not in 21 hardcoded domains                        │
└───────────────────────────────────┬─────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│             Output Gate Phase: Tool Output Scanner (Advanced Secure)            │
│  - Outputs > 64 KiB trigger OUTPUT_TOO_LARGE ──▶ Prompt (Default: Withhold)     │
│  - Token / Secret Detected ──▶ Prompt (Default: Withhold entire output)         │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Friction Point 1: Pre-flight Outside-Project Reads
- **Code Reference:** `src/l1-sandbox/bash-ops.ts` (`preflightOutsideReads`), `src/core/policy/fence.ts` (`readPathCandidates`, `READ_COMMANDS`).
- **Mechanism:** When `filesystem.outsideProject.read` is `"ask"` (or when fencing triggers), any command whose head is in `READ_COMMANDS` (`ls`, `cat`, `grep`, `find`, `stat`, `file`, etc.) and specifies an argument outside `<cwd>` triggers a prompt:
  ```text
  ❓ Let this command read a file outside your project?
  File: /etc/os-release
  Default: No (15s)
  ```
- **The Bug / Friction:** 
  - An agent inspecting system diagnostics (e.g., `cat /etc/os-release`, `uname -a`, `which node`, `file /bin/sh`) is asking for public OS metadata, not user secrets.
  - If the user is in another tab or reading documentation, the 15-second timer expires.
  - The prompt resolves to `MainChoice.Block`, returning `exitCode: 1` with `❌ pi-sandbox: Read blocked by policy: outside the project`.
  - The agent interprets this as a command failure and stalls.

### 2.2 Friction Point 2: Sensitive Commands False Positives & No Persistence
- **Code Reference:** `src/l1-sandbox/bash-ops.ts` (`preflightSensitiveCommands`), `src/core/policy/commands.ts` (`matchedAskCommands`).
- **Mechanism:** `sandbox.default.json` ships `"commands": { "ask": ["printenv", "env", "/proc/*/environ"] }`.
- **The Flaw:**
  - `matchedAskCommands()` checks if `head === entry`. Therefore, any command using `env` as a runner or wrapper—such as `env NODE_ENV=development npm start` or `env PATH=... python main.py`—matches `head === "env"`.
  - Unlike file or network asks, `preflightSensitiveCommands()` offers **only `once`**. There is **no conversation grant** and **no remember option** (ADR-017: *"The gate offers only Allow once; per-command persistence would need a new override kind"*).
  - Every single invocation prompts. Unattended timer expiration immediately aborts the run.

### 2.3 Friction Point 3: Filesystem Write Denials on Normal Tool Caches
- **Code Reference:** `src/l1-sandbox/bash-ops.ts` (`isWriteBlockError`), `src/core/policy/defaults.ts` (`DEFAULT_ALLOW_WRITE = [".", "/tmp"]`).
- **Mechanism:** Bubblewrap mounts `/` as read-only (`--ro-bind / /`), granting write access only to `allowWrite` paths (`.` and `/tmp`).
- **The Reality of Modern Developer Tooling:**
  - Modern tools write caches and configuration outside `.` and `/tmp`:
    - Python (`pip`, `uv`): `~/.cache/pip`, `~/.cache/uv`
    - Node (`npm`, `yarn`, `pnpm`): `~/.npm`, `~/.cache/yarn`
    - Rust (`cargo`, `rustup`): `~/.cargo/registry`, `~/.rustup`
    - Go: `~/go/pkg/mod`, `~/.cache/go-build`
    - Docker: `~/.docker/config.json`, `~/.docker/contexts`
  - When these CLIs write to cache, the Linux kernel returns `EROFS` (`Read-only file system`).
  - Layer 1 catches this via `isWriteBlockError(outputTail)`, interrupts execution, and prompts:
    ```text
    Let pip save files in /home/user/.cache/pip/?
    Default: No (15s)
    ```
  - Unattended timeout denies the write. The CLI exits with error code 1.

### 2.4 Friction Point 4: Output Scanner Ceiling (64 KiB)
- **Code Reference:** `src/detect/tool-output-scanner/constants.ts` (`TOOL_OUTPUT_DEFAULT_MAX_BYTES = 64 * 1024`), `src/detect/tool-output-scanner/evaluate.ts`.
- **Mechanism:** 
  - To prevent performance degradation, the output scanner caps inspection at 64 KiB.
  - However, when an output exceeds 64 KiB (very common with `npm install`, `docker build`, `git log`, test suite outputs), `evaluate.ts` issues `OUTPUT_TOO_LARGE` with risk score 100!
  - In `extensions/guard.ts`, this triggers an exposure prompt (`askExposure`).
  - If unattended, the output is withheld from the LLM:
    ```text
    🛡 Advanced Secure: blocked bash output — it may contain sensitive information. Nothing was sent to the model.
    ```
  - The model receives zero output, thinks the command produced nothing, and fails to diagnose build or test failures.

---

## 3. The Docker Problem: Why Docker Fails Without YOLO Mode

When a user executes `docker ps`, `docker build`, or `docker run` inside the default sandbox, it fails with:
```text
Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?
```
or `permission denied` / `Operation not permitted`. Turning on `--yolo` works because YOLO bypasses the sandbox completely.

### 3.1 Technical Root Causes

#### 1. Seccomp BPF Unix Socket Blocking (Primary Blocker)
In `@anthropic-ai/sandbox-runtime` (`linux-sandbox-utils.js` lines 2388–2403):
```javascript
// ========== SECCOMP FILTER (Unix Socket Blocking) ==========
// apply-seccomp wraps the workload and applies the baked-in BPF filter
// that blocks socket(AF_UNIX, ...). Skipped when allowAllUnixSockets is true.
if (!allowAllUnixSockets) {
    applySeccompPrefix = resolveApplySeccompPrefix(seccompConfig?.applyPath, seccompConfig?.argv0);
    // ... Applies seccomp filter for Unix socket blocking
}
```
- On Linux, `@anthropic-ai/sandbox-runtime` compiles and installs an `apply-seccomp` filter that intercepts every `socket()` system call.
- If the domain is `AF_UNIX` (Unix domain socket), the kernel returns `EPERM`!
- The Docker CLI communicates exclusively with `/var/run/docker.sock` over an `AF_UNIX` stream socket.
- Because `auto-permission-system` does not configure `network.allowAllUnixSockets: true`, **Docker CLI cannot open a socket to the Docker daemon.**

#### 2. Filesystem Mount Isolation of the Socket File
- In bubblewrap, `/` is mounted as `--ro-bind / /`.
- A Unix domain socket requires bidirectional read/write permissions at the filesystem VFS layer for connection establishment.
- If `/var/run` (or `/run`) is mounted read-only, or if the socket is located in a user-specific runtime directory (`/run/user/<uid>/docker.sock` for rootless Docker), the connection is refused unless explicitly bound as read-write.

#### 3. State & Configuration Directory (`~/.docker`)
- Docker CLI writes authentication tokens, active contexts, and buildx caches to `~/.docker/config.json`.
- Because `~/.docker` is not in `allowWrite`, any Docker CLI command attempting to update state fails with `EROFS`.

#### 4. Network Registry Access
- `docker pull` and `docker build` contact container registries (`registry-1.docker.io`, `auth.docker.io`, `production.cloudflare.docker.com`, `ghcr.io`, `quay.io`).
- `sandbox.default.json` only whitelists npm, github, pypi, and language package managers. Docker registries are completely omitted, causing proxy stalls and prompts.

#### 5. Docker-in-Docker / Devcontainer User Namespaces
- If the agent itself is running inside a Docker container (devcontainer, CI runner), bubblewrap cannot create unprivileged user namespaces without `enableWeakerNestedSandbox: true` (or `--cap-add=SYS_ADMIN`).

### 3.2 Security Implications of Enabling Docker
> [!WARNING]
> Granting unrestricted access to `/var/run/docker.sock` gives a process effective root access to the host (via `docker run -v /:/host ...`).
> 
> However, forcing the user into **YOLO mode** to run Docker is far more dangerous: YOLO disables *all* Layer 1 filesystem isolation, *all* network domain controls, and *all* Layer 2 secret inspection! Enabling controlled Docker within the sandbox is drastically safer than running in YOLO mode.

---

## 4. The Safety Net: Output Scanner Capabilities

The user noted:
> *"Also, there is an output scanner as well for the security and the token leak as well. So it is fine to execute the commands."*

This observation is spot on. Let's analyze what the output scanner already guards:

### 4.1 What the Output Scanner Already Protects
`src/detect/tool-output-scanner` and `src/detect/sensitive-file-scanner` contain an enterprise-grade detection suite:
1. **High-Confidence API Keys & Tokens:**
   - Anthropic API keys (`sk-ant-api03-...`)
   - OpenAI API keys (`sk-[A-Za-z0-9]{32,}`)
   - GitHub Personal Access Tokens (`ghp_...`, `gho_...`, `github_pat_...`)
   - AWS Access Key IDs (`AKIA[0-9A-Z]{16}`) and Secret Keys
   - Slack tokens (`xox[baprs]-...`), Google API keys (`AIza...`)
   - Private Keys (PEM/RSA/DSA/EC/OpenSSH headers)
   - Bearer tokens (`Bearer <token>`)
   - JWT tokens (`eyJ...`)
2. **Database & Connection Strings:**
   - URIs with credentials (`postgres://user:pass@host`, `mongodb://...`, `redis://...`)
   - Password parameters in query strings or config lines (`password=...`, `pwd=...`)
3. **Shannon Entropy & Keyword Assignment:**
   - High-entropy random strings assigned to sensitive keys (`secret`, `token`, `auth`, `api_key`).
4. **Base64 Blob Decoding:**
   - Decodes embedded base64 chunks before scanning to catch obfuscated secrets.
5. **Redaction Engine:**
   - `redactText()` can replace discovered secrets with `[REDACTED_...]` masks.

### 4.2 The Strategic Realization
Because the output scanner actively monitors **everything returning from the terminal to the AI model**, the risk of executing a read or diagnostic command is near zero. If a CLI accidentally prints an API key, the output scanner catches it before the LLM sees it.

Therefore:
- **Blocking harmless CLI commands before execution is redundant friction.**
- **The system should adopt "Optimistic Execution with Sanitized Output".**

---

## 5. Architectural Blueprint: The Autonomous & Secure System

We propose four targeted architectural enhancements:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             ENHANCEMENT 1: COMMAND ENGINE                        │
│                                                                                  │
│  [ Tier 1: Harmless CLIs ]  ──▶ Instant Execution (Zero Prompts)                │
│  [ Tier 2: Standard CLIs ]  ──▶ Prompt with Default-Allow Countdown (Autonomous) │
│  [ Tier 3: Harmful Actions] ──▶ Strict Hard-Block / Explicit Confirmation        │
└──────────────────────────────────────────────────────────────────────────────────┘
                                         │
┌────────────────────────────────────────┴─────────────────────────────────────────┐
│                           ENHANCEMENT 2: FILESYSTEM & CACHES                     │
│                                                                                  │
│  - Default allowWrite includes: ~/.cache, ~/.npm, ~/.cargo, ~/.docker, /tmp      │
│  - System info paths (/etc/os-release, /usr, /lib) exempt from outside fence     │
└──────────────────────────────────────────────────────────────────────────────────┘
                                         │
┌────────────────────────────────────────┴─────────────────────────────────────────┐
│                           ENHANCEMENT 3: DOCKER SANDBOX PROFILE                  │
│                                                                                  │
│  - network.allowAllUnixSockets: true                                             │
│  - Bind mount /var/run/docker.sock and rootless sockets                          │
│  - Whitelist Docker registries in network.allowedDomains                         │
└──────────────────────────────────────────────────────────────────────────────────┘
                                         │
┌────────────────────────────────────────┴─────────────────────────────────────────┐
│                           ENHANCEMENT 4: OUTPUT SCANNER AUTO-REDACT              │
│                                                                                  │
│  - Mask detected tokens with [REDACTED] & forward to model without stopping      │
│  - Raise scan ceiling from 64 KiB to 256 KiB; window large logs (head+tail)      │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

### 5.1 Enhancement 1: Tri-Tier Command Classification Engine

Replace the current binary "is it outside cwd? -> prompt" with a semantic command tiering system:

#### Tier 1: Harmless / Safe Commands (Instant Execution, Zero Prompts)
Commands that read public system information, perform diagnostics, or run project builds:
- **System Information:** `uname`, `whoami`, `hostname`, `arch`, `date`, `uptime`, `id`, `locale`, `which`, `whereis`, `type`.
- **System Resource Queries:** `ps`, `top -b -n 1`, `df`, `free`, `lsof`, `uptime`.
- **Read-Only Inspection:** `cat`, `head`, `tail`, `wc`, `grep`, `rg`, `find`, `file`, `stat`, `diff` when operating on:
  - System definitions: `/etc/os-release`, `/etc/issue`, `/proc/cpuinfo`, `/proc/meminfo`, `/proc/version`.
  - Binary/library trees: `/usr/*`, `/lib/*`, `/lib64/*`, `/bin/*`, `/sbin/*`, `/opt/*`.
- **Git Read Operations:** `git status`, `git log`, `git diff`, `git branch`, `git show`, `git rev-parse`, `git tag`.
- **Tool Versions & Diagnostics:** Any command with `--version`, `-v`, `--help`, `-h`.
- **Project Build & Test Execution:** `npm test`, `npm run build`, `cargo check`, `cargo test`, `pytest`, `go test`, `python -m unittest` within project.

#### Tier 2: Benign / Standard CLI Commands (Default-Allow on Timeout)
Commands that perform network downloads, project operations, or tool invocations not matching Tier 1 or Tier 3:
- If a prompt is triggered (e.g., an unfamiliar domain or outside-project directory write):
  - Follow the **ADR-024 pattern**: Prompt displays `Allow (Default)` / `Block` / `Session` / `Remember`.
  - **The Countdown Default flips to: `Yes, just this once`** (instead of `No`).
  - If the user is away reading, the timer (15s) expires and **allows the execution**.
  - **Protection:** Downstream Output Scanner guarantees tokens are not leaked; audit log records the auto-grant (`note: "autonomous-allow-once"`).

#### Tier 3: Harmful / High-Risk Operations (Strict Default-Deny, Hard Gates)
Commands that can cause irreversible damage, steal credentials, or compromise system integrity:
- **Destructive Filesystem Operations:**
  - `rm -rf /`, `rm -rf ~`, `rm -rf /*`, `mkfs.*`, `dd if=... of=/dev/...`.
- **Privilege Escalation:**
  - `sudo`, `su`, editing `/etc/sudoers`, `chmod +s`, `chown root`.
- **Persistence & Startup File Hijacks:**
  - Modifying `~/.bashrc`, `~/.zshrc`, `~/.profile`, `~/.bash_profile`, `~/.config/fish`.
- **Direct Credential Exfiltration / Access:**
  - Reading `~/.ssh/*`, `~/.aws/*`, `~/.gnupg/*`, `~/.netrc`, `~/.pi/agent/auth.json`.
  - Commands piping credentials to network utilities (`cat ~/.ssh/id_rsa | curl ...`).
- **Unparameterized Environment Variable Dumps:**
  - Bare `printenv` or `env` (without arguments) dumping all process memory and secrets.
- **Rule for Tier 3:**
  - **Never auto-allows.**
  - Timeout defaults strictly to **`Block`**.
  - Requires active user interaction (`No (recommended)` preselected).

---

### 5.2 Enhancement 2: Developer Tooling & Cache Whitelist

Update default policy (`sandbox.default.json` and `src/core/policy/defaults.ts`) to recognize standard tool caches:

```jsonc
"filesystem": {
  "allowWrite": [
    ".",
    "/tmp",
    "~/.cache",
    "~/.npm",
    "~/.cargo/registry",
    "~/.cargo/git",
    "~/.local/share",
    "~/.docker"
  ],
  "outsideProject": {
    "read": "allow",
    "allowRead": [
      "/etc/os-release",
      "/etc/issue",
      "/proc/cpuinfo",
      "/proc/meminfo",
      "/proc/version",
      "/usr",
      "/lib",
      "/lib64",
      "/bin",
      "/opt"
    ]
  }
}
```

**Benefits:**
- `pip install`, `uv run`, `npm install`, `cargo build`, and `go get` execute without triggering spurious EROFS write prompts.
- Public system metadata can be queried without triggering outside-project fence warnings.

---

### 5.3 Enhancement 3: Docker Sandbox Enablement Architecture

Enable Docker CLI within the sandbox without requiring YOLO mode:

#### 1. Configuration Field: `network.allowAllUnixSockets`
In `sandbox.default.json` or `~/.pi/agent/extensions/sandbox.json`:
```json
{
  "network": {
    "allowAllUnixSockets": true
  }
}
```
- In `src/l1-sandbox/manager.ts`, ensure `allowAllUnixSockets` is passed directly to `runtimeConfig`:
  ```typescript
  function runtimeConfig(cwd: string, config: SandboxConfig): SandboxRuntimeConfig {
    return {
      network: {
        ...config.network,
        allowAllUnixSockets: config.network?.allowAllUnixSockets ?? false,
      },
      // ...
    };
  }
  ```
- When `allowAllUnixSockets` is `true`, `sandbox-runtime` disables the Seccomp BPF filter that blocks `socket(AF_UNIX)`.

#### 2. Bind Mount Docker Socket
Add `/var/run/docker.sock` (and rootless `/run/user/${UID}/docker.sock`) to the sandbox filesystem binds:
- Bind mount `/var/run/docker.sock` to `/var/run/docker.sock`.
- Bind mount `~/.docker` as read-write under `allowWrite`.

#### 3. Whitelist Docker Container Registries
Add essential container registries to `network.allowedDomains`:
```json
"allowedDomains": [
  "docker.io",
  "*.docker.io",
  "registry-1.docker.io",
  "auth.docker.io",
  "production.cloudflare.docker.com",
  "docker.com",
  "*.docker.com",
  "ghcr.io",
  "quay.io",
  "gcr.io",
  "*.gcr.io"
]
```

#### 4. Devcontainer Nested Sandbox Support
For users running inside Docker/Devcontainers:
- Expose `"enableWeakerNestedSandbox": true` in `sandbox.json`, which instructs bubblewrap to skip `--proc /proc` remounting if unprivileged namespaces are restricted.

---

### 5.4 Enhancement 4: Output Scanner Optimization ("Redact-and-Forward")

Transform the Output Scanner from a workflow blocker into an automated sanitizer:

#### 1. Auto-Redact Mode
Currently, discovering a token in command output triggers `askExposure` and halts. If unanswered, the entire output is withheld (`withheldNotice`).
- **New Behavior:** When a secret is detected in tool output:
  - Automatically apply `redactText(content)` to replace the secret with `[REDACTED_API_KEY]` or `[REDACTED_TOKEN]`.
  - Forward the redacted output to the model immediately.
  - Audit the finding in `audit.log` (`note: "auto-redacted"`).
  - Notify the user with a subtle non-blocking chip: `🛡 Secret detected & redacted in bash output`.
  - **Result:** The LLM gets the output it needs to continue working, while zero tokens or credentials leak!

#### 2. Raise Output Scan Ceiling & Windowing
- Increase `TOOL_OUTPUT_DEFAULT_MAX_BYTES` from `64 * 1024` to `256 * 1024` (256 KiB).
- For outputs exceeding 256 KiB: Instead of failing closed with `OUTPUT_TOO_LARGE`:
  - Scan the first 64 KiB (header/environment) and the last 64 KiB (trailing logs/stack traces).
  - Allow the output through with an audit note, rather than withholding the entire output from the LLM.

---

## 6. Implementation Plan & Concrete Code Changes

### Step 1: Update Default Policy (`sandbox.default.json`)
Modify `sandbox.default.json` to relax developer caches, allow Docker registries and Unix sockets, and whitelist OS info paths:

```json
{
  "enabled": true,
  "mode": "advanced-secure",
  "network": {
    "allowAllUnixSockets": true,
    "allowedDomains": [
      "registry.npmjs.org",
      "registry.yarnpkg.com",
      "npmjs.org",
      "*.npmjs.org",
      "pypi.org",
      "*.pypi.org",
      "files.pythonhosted.org",
      "github.com",
      "*.github.com",
      "api.github.com",
      "raw.githubusercontent.com",
      "objects.githubusercontent.com",
      "codeload.github.com",
      "crates.io",
      "static.crates.io",
      "proxy.golang.org",
      "sum.golang.org",
      "repo.maven.apache.org",
      "rubygems.org",
      "api.nuget.org",
      "deno.land",
      "jsr.io",
      "docker.io",
      "*.docker.io",
      "registry-1.docker.io",
      "auth.docker.io",
      "production.cloudflare.docker.com",
      "docker.com",
      "*.docker.com",
      "ghcr.io",
      "quay.io"
    ]
  },
  "filesystem": {
    "outsideProject": {
      "read": "allow",
      "allowRead": [
        "/etc/os-release",
        "/etc/issue",
        "/proc/cpuinfo",
        "/proc/meminfo",
        "/proc/version",
        "/usr",
        "/lib",
        "/lib64",
        "/bin",
        "/opt"
      ]
    },
    "denyRead": [],
    "askRead": [
      ".env",
      ".env.*",
      "*.pem",
      "*.key",
      "*.p12",
      "*.pfx",
      "*.keystore",
      "*.ppk",
      "id_rsa",
      "id_rsa.*",
      "id_ed25519",
      "id_ed25519.*",
      "id_ecdsa",
      "id_ecdsa.*",
      ".netrc",
      ".npmrc",
      ".pypirc",
      ".gitconfig",
      ".git-credentials",
      "credentials",
      "*.credentials",
      "credentials.toml",
      "hosts.yml",
      "auth.json",
      "mcp.json",
      "mcp-auth.json",
      "models-store.json",
      "trust.json",
      "audit.log",
      "sessions"
    ],
    "modelDenyRead": [],
    "allowWrite": [
      ".",
      "/tmp",
      "~/.cache",
      "~/.npm",
      "~/.cargo/registry",
      "~/.cargo/git",
      "~/.local/share",
      "~/.docker"
    ],
    "denyWrite": [],
    "askWrite": [
      ".env",
      ".env.*",
      "*.pem",
      "*.key",
      "*.p12",
      "*.pfx",
      "auth.json",
      "mcp.json",
      "mcp-auth.json",
      "~/.gnupg",
      "~/.ssh/**",
      "~/.pi/agent/extensions",
      "~/.pi/agent/extensions/**",
      "~/.pi/agent/auth.json",
      "~/.pi/agent/mcp.json",
      "~/.pi/agent/mcp-auth.json",
      "~/.pi/agent/trust.json",
      "~/.pi/agent/models-store.json",
      "~/.pi/agent/audit.log",
      "~/.pi/agent/sessions",
      "~/.pi/sessions",
      "~/.bashrc",
      "~/.zshrc",
      "~/.profile",
      "~/.bash_profile"
    ]
  },
  "subagent": {
    "network": "allow"
  },
  "commands": {
    "ask": [
      "printenv",
      "/proc/*/environ"
    ]
  },
  "overrides": {
    "allowRead": [],
    "allowWrite": [],
    "allowDomains": []
  }
}
```

### Step 2: Fix Command Pre-flight & Wrap in `commands.ts`
In `src/core/policy/commands.ts`:
Refine `matchedAskCommands` so `env` is only flagged when it is invoked as a bare dump (`env` with no command arguments), rather than when used as a command prefix (`env NODE_ENV=test cmd`):
```typescript
export function matchedAskCommands(command: string, askEntries: readonly string[], cwd: string, home: string): string[] {
    const found = new Set<string>();
    if (!askEntries.length) return [];
    for (const segment of shellSegments(command)) {
        const tokens = shellTokens(segment);
        const head = (tokens[0] ?? "").split("/").pop() ?? "";
        
        // If entry is 'env', only match if it has no subsequent command tokens
        // e.g., 'env' or 'env -i' alone is a dump; 'env FOO=bar node index.js' is an execution.
        if (head === "env") {
            const nonVarTokens = tokens.slice(1).filter(t => !t.startsWith("-") && !t.includes("="));
            if (nonVarTokens.length > 0) {
                // There is a command following 'env'; not a bare environment dump!
                continue;
            }
        }

        for (const entry of askEntries) {
            if (!entry) continue;
            if (entry.includes("/") || entry.startsWith("~")) {
                for (const raw of tokens.slice(1)) {
                    const absolute = asAbsolutePath(raw, cwd, home);
                    if (absolute && matchesPolicyPattern(absolute, entry, cwd, home)) {
                        found.add(`${head} ${raw}`.trim());
                    }
                }
            } else if (head === entry) {
                found.add(entry);
            }
        }
    }
    return [...found];
}
```

### Step 3: Implement Autonomous Default-Allow on Benign Timeout
In `src/l1-sandbox/bash-ops.ts`:
When `preflightOutsideReads` or Layer 1 write prompts are shown for standard developer actions:
- Pass `allowFirst: true` to `askMainWithRemember`.
- When the 15s timer expires unattended, the prompt resolves to `MainChoice.Once`.
- This mirrors ADR-024 for network requests: the command completes, the agent proceeds, and the action is audited as `autonomous-once`.

### Step 4: Pass Unix Sockets & Docker Mounts to Sandbox Manager
In `src/l1-sandbox/manager.ts`:
Ensure `allowAllUnixSockets` from `config.network` is passed into `SandboxRuntimeConfig`:
```typescript
function runtimeConfig(cwd: string, config: SandboxConfig): SandboxRuntimeConfig {
    return {
        network: {
            ...config.network,
            allowAllUnixSockets: config.network?.allowAllUnixSockets ?? false,
        },
        filesystem: config.filesystem
            ? sandboxFilesystem(config.filesystem, { cwd, home: homedir() })
            : { denyRead: [], allowRead: [], allowWrite: [], denyWrite: [], disabled: true },
        ignoreViolations: config.ignoreViolations,
        enableWeakerNestedSandbox: config.enableWeakerNestedSandbox,
    };
}
```

### Step 5: Output Scanner Auto-Redaction & Ceiling Raise
In `src/detect/tool-output-scanner/constants.ts`:
```typescript
export const TOOL_OUTPUT_DEFAULT_MAX_BYTES = 256 * 1024; // 256 KiB
```
In `extensions/guard.ts` (`tool_result` hook):
When exposure findings are detected:
- Automatically apply `redactText` to sanitize tokens in the tool result.
- Forward the sanitized output to the model without withholding the entire payload.

---

## 7. Comparative Impact Matrix

| Dimension | Current System | Proposed Streamlined System |
|---|---|---|
| **Autonomous Operation** | Pauses frequently; 15s unattended timeout **denies** and terminates agent. | Harmless CLIs run instantly; benign timeouts **allow once**; agent runs uninterrupted. |
| **Docker Support** | Fails completely due to Seccomp `AF_UNIX` block. Requires dangerous `--yolo` mode. | Fully supported in sandbox via `allowAllUnixSockets: true` and `/var/run/docker.sock` access. |
| **Tool Caching (`pip`, `npm`, `cargo`)** | Triggers `EROFS` write errors on `~/.cache`, `~/.npm`, `~/.cargo`. | Pre-whitelisted in `allowWrite`; builds and package installs run cleanly. |
| **Sensitive Command Wrapping** | `env VAR=val cmd` flags as sensitive secret dump; prompts every run with no persistence. | Distinguishes bare `env` dumps from command wrapping; only dumps prompt. |
| **Output Scanner Interaction** | Outputs > 64 KiB trigger `OUTPUT_TOO_LARGE` and withhold entire payload. | Ceiling raised to 256 KiB; detected tokens auto-redacted and forwarded safely. |
| **Credential / Data Protection** | Protected via prompts and fences. | **Equally secure:** `denyWrite`, `denyRead`, `askRead` for `.env`, `~/.ssh`, `~/.aws`, and token output scanner remain strictly enforced. |

---

## 8. Summary of Recommendations & Next Steps

1. **Deploy the relaxed `sandbox.default.json`**: Enable `allowAllUnixSockets`, add developer cache directories to `allowWrite`, and include container registries.
2. **Apply the `env` command fix in `commands.ts`**: Stop prompting on `env VAR=val cmd`.
3. **Adopt "Default Allow Once on Timeout" for Benign Operations**: Replicate the success of ADR-024 across bash pre-flight checks.
4. **Enable Auto-Redaction in Output Gate**: Allow the Output Scanner to redact discovered tokens and pass the sanitized output, rather than halting execution.
5. **Test Docker without YOLO**: Verify `docker ps`, `docker build`, and `docker run` succeed under the relaxed profile.
