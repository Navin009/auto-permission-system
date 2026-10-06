/**
 * Default policy lists, shared by both layers so they cannot drift.
 *
 * `~/.pi/agent` holds `mcp.json` (which can carry API keys), session
 * transcripts and caches; only `auth.json` was guarded before. It is a
 * default deny so Layer 1 (bash) is covered too, not just the model tools.
 */
export const DEFAULT_DENY_READ = ["~/.ssh", "~/.aws", "~/.gnupg", "~/.pi/agent"];
export const DEFAULT_ALLOW_WRITE = [".", "/tmp"];
export const DEFAULT_DENY_WRITE = [".env", ".env.*", "*.pem", "*.key"];
