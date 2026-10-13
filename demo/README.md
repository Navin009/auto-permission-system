# Auto Permission System: Demo & Recording Suite

This directory contains the testing environment, simulated attack & workflow scenarios, and the recording generator for the [Pi coding agent](https://pi.dev) permission system.

## Contents

- **`test-workspace/`**: A mock project environment containing realistic configuration files, `.env` files with credential formats, and source code.
- **`simulate-session.py`**: An executable CLI simulation of the Pi coding agent interacting with the multi-layer security system in Secure Auto Mode.
- **`run-demo.sh`**: One-command runner to execute the terminal demo.
- **`generate-recording.py`**: High-fidelity terminal recording generator that produces:
  - `assets/demo.mp4` (H.264 high-resolution MP4)
  - `assets/demo.gif` (Palette-optimized looping GIF for GitHub and NPM)

---

## Demonstrated Scenarios

| Scenario | Layer | Threat Defended | Security Behavior |
|---|---|---|---|
| **1. Sensitive `.env` Read** | Layer 2 Guard | Accidental exposure or exfiltration of database credentials and API keys | Intercepts `read(".env")`. Displays interactive Ask Prompt with a 10s countdown. User selects `No` (pre-selected default). AI is safely denied without seeing secrets. |
| **2. Kernel OS Sandbox Confinement** | Layer 1 Sandbox | Malicious child processes or prompt injection attempting system tampering (`touch /etc/...`) | Bubblewrap / sandbox-exec enforces read-only filesystem. Kernel blocks the call with `EROFS: Read-only file system`. |
| **3. Governed Network Egress** | Layer 1 Proxy | Unauthorized phone-home or data exfiltration (`curl https://untrusted-domain.com`) | Network gate intercepts unapproved socket. Displays interactive domain ask prompt with a 15s countdown. Esc/timeout blocks connection. |
| **4. Real-Time Secret Redaction** | Layer 3 Auto Secure | Exposed API keys or secrets in CLI stdout/stderr streams (`sk-proj-...`, `ghp_...`, tokens) | AST and regex scanner detects secret signature. Prompts user with redaction choice (`No, keep private`). Secret is replaced with `***REDACTED***` before reaching the LLM context. |
| **5. Claude Auto Mode in CI/CD** | All Layers | Autonomous headless pipelines deadlocking on interactive human prompts | Runs headless (`pi -p`). `sandbox.claude.json` fails closed automatically, preventing unmonitored data breaches without hanging. |

---

## Running the Demo

```bash
# Run terminal simulation
./demo/run-demo.sh

# Re-generate MP4 and GIF recording assets
python3 demo/generate-recording.py
```

Generated assets are saved directly to `assets/demo.mp4` and `assets/demo.gif`.
