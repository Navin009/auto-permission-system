#!/usr/bin/env python3
"""
demo/simulate-session.py
An interactive or scripted terminal walkthrough of auto-permission-system.
Demonstrates:
  1. L2 Guard intercepting .env reads (Interactive Ask Tier)
  2. L1 OS Sandbox kernel write boundary (Bubblewrap EROFS refusal)
  3. L1 Network domain intercept with countdown
  4. Advanced Secure real-time API key & secret redaction
  5. Claude Auto Mode: Secure autonomous mode for Pi (like Claude auto mode)
"""

import time

CYAN = "\033[38;2;88;166;255m"
GREEN = "\033[38;2;63;185;80m"
YELLOW = "\033[38;2;210;153;34m"
RED = "\033[38;2;248;81;73m"
PURPLE = "\033[38;2;188;140;255m"
MUTED = "\033[38;2;139;148;158m"
BOLD = "\033[1m"
RESET = "\033[0m"

def step(title):
    print(f"\n{BOLD}{PURPLE}═══ {title} ═══{RESET}\n")
    time.sleep(0.5)

def main():
    print(f"{GREEN}$ pi{RESET}")
    print(f"{MUTED}Pi Coding Agent v1.2.0 initialized in /home/user/workspace/app{RESET}")
    print(f"{MUTED}Loaded extensions: {PURPLE}auto-permission-system v3.8.0{RESET}")
    print(f"{MUTED}Status: {GREEN}Sandbox: 🧠 Advanced Secure (21 allowed domains, 2 roots){RESET}")
    time.sleep(0.8)

    step("Scenario 1: Interactive .env Read Protection (Layer 2)")
    print(f"{CYAN}pi >{RESET} Verify database connection and review environment configuration")
    print(f"{MUTED}● Agent: Calling tool read(\".env\")...{RESET}")
    time.sleep(0.6)

    print(f"\n{YELLOW}{BOLD}🔑  Let pi read your .env file?{RESET}")
    print("    File     ~/workspace/app/.env")
    print("    Why      .env files usually hold passwords and API keys")
    print(f"    {RED}Risk     the AI will see any keys in it{RESET}")
    print("    Note     cannot be saved as permanent rule (secrets tier)")
    print(f"\n  {CYAN}{BOLD}→ No{RESET}")
    print("    Yes, just this once")
    print("    Yes, for this conversation")
    print(f"\n  {MUTED}Default: No (10s){RESET}")
    time.sleep(1.0)
    print(f"\n{RED}✗ Access blocked: denyRead matched \".env\" (Zero-Trust Guard){RESET}")
    print(f"{MUTED}  Audit logged: ~/.pi/agent/audit.log (decision: no, layer: 2){RESET}")
    print(f"{GREEN}✓ Protected: AI agent receives safe refusal without data exposure.{RESET}")

    step("Scenario 2: Layer 1 Kernel Sandbox Write Confinement (Bubblewrap)")
    print(f"{MUTED}● Agent: Attempting bash write: touch /etc/system_cron...{RESET}")
    time.sleep(0.6)
    print(f"{RED}EROFS: Read-only file system, open '/etc/system_cron'{RESET}")
    print(f"{RED}✗ OS Sandbox Refusal: Bubblewrap kernel boundary blocked write outside project.{RESET}")
    print(f"{GREEN}✓ Host system protected against accidental or malicious tampering.{RESET}")

    step("Scenario 3: Governed Network Egress & Domain Countdown Prompt")
    print(f"{MUTED}● Agent: Attempting bash: curl -s https://unknown-telemetry.io/ping...{RESET}")
    time.sleep(0.6)
    print(f"\n{CYAN}{BOLD}🌐  Let bash connect to unknown-telemetry.io?{RESET}")
    print("    Site     unknown-telemetry.io")
    print("    Command  curl -s https://unknown-telemetry.io/ping")
    print("    Why      this site isn't on your allowed list yet")
    print(f"\n  {CYAN}{BOLD}→ No{RESET}")
    print("    Yes, just this once")
    print("    Yes, all in group for this conversation")
    print("    Yes, always…")
    print(f"\n  {MUTED}Default: Yes, just this once (15s){RESET}")
    time.sleep(1.0)
    print(f"\n{RED}✗ Network blocked: Sandbox proxy refused unapproved host (unknown-telemetry.io){RESET}")
    print(f"{GREEN}✓ Zero data exfiltration: Socket connection closed at kernel level.{RESET}")

    step("Scenario 4: Real-Time API Key & Secret Token Redaction (Advanced Secure)")
    print(f"{MUTED}● Agent: Running service verification script...{RESET}")
    print(f"{MUTED}  [info] Verifying upstream cloud endpoint...{RESET}")
    print(f"{RED}  [auth] Configured key: sk-proj-a9F8d2K1m... [EXPOSED IN STDOUT]{RESET}")
    time.sleep(0.6)
    print(f"\n{RED}{BOLD}⚠  Sensitive information detected: OpenAI API key{RESET}")
    print("    Tool     bash (node verify_service.js)")
    print("    Finding  23: sk-(?!ant-)[A-Za-z0-9_-]")
    print("    Question Should the AI be allowed to see it?")
    print(f"\n  {CYAN}{BOLD}→ No, keep private  (recommended){RESET}")
    print("    Yes, allow")
    time.sleep(1.0)
    print(f"\n{GREEN}✓ Advanced Secure Active: Secret masked before entering AI context window.{RESET}")
    print(f"{PURPLE}  AI Context: [auth] Configured key: ***REDACTED*** (content withheld){RESET}")

    step("Scenario 5: Claude Auto Mode (Secure Autonomous Auto Mode for Pi)")
    print(f"{GREEN}$ pi -p \"Deploy release in headless auto mode\"{RESET}")
    print(f"{CYAN}Mode: Claude Auto Mode (sandbox.claude.json){RESET}")
    print(f"{MUTED}Enforcement: Fail-Closed | Subagent Network: Deny | Content Scan: Active{RESET}")
    time.sleep(0.8)
    print(f"{GREEN}✓ Claude-style Auto Mode for Pi: autonomous execution with zero leaks and zero deadlocks.{RESET}")
    print(f"\n{BOLD}{PURPLE}═══════════════════════════════════════════════════════════════════════{RESET}")
    print(f"{BOLD}  auto-permission-system: 100% Zero-Trust Security for Pi Active      {RESET}")
    print(f"{BOLD}  Install: pi install npm:auto-permission-system                     {RESET}")
    print(f"{BOLD}{PURPLE}═══════════════════════════════════════════════════════════════════════{RESET}\n")

if __name__ == "__main__":
    main()
