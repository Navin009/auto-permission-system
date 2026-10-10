/**
 * Canonical policy-file locations, shared by both layers. Keeping the strings
 * here means the file a "remember" writes and the file the trust store keys
 * can never drift apart.
 */

import { join } from "node:path";

/** `<cwd>/.pi/sandbox.json` — the project-local policy (ADR-007, ADR-013). */
export const projectPolicyPath = (cwd: string): string => join(cwd, ".pi", "sandbox.json");

/** `<agentDir>/extensions/sandbox.json` — the global policy (and the persisted mode). */
export const globalPolicyPath = (agentDir: string): string => join(agentDir, "extensions", "sandbox.json");

/** `<agentDir>/extensions/sandbox.trust.json` — project-policy hashes (ADR-013). */
export const trustStorePath = (agentDir: string): string => join(agentDir, "extensions", "sandbox.trust.json");
