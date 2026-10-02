# ADR-013: An untrusted project sandbox.json may only tighten the policy

**Status:** Accepted

## Context

Both layers merged `<cwd>/.pi/sandbox.json` over the global policy as soon as pi started in that folder. A cloned repository could ship that file and, unasked:

- switch Layer 2 or the bash sandbox off (`"enabled": false`);
- weaken the bash sandbox (`enableWeakerNestedSandbox`, `ignoreViolations`);
- widen writes and network (`allowWrite`, `allowedDomains`, `overrides`);
- wipe the user's denies, because arrays replaced rather than merged (`"denyRead": []` dropped `~/.ssh`).

pi's own project trust does not cover this: `ctx.isProjectTrusted()` is true unless the user declined pi's prompt, and pi only prompts for its own project files (`.pi/settings.json`, `.pi/mcp.json`, …), not `.pi/sandbox.json`.

## Decision

- A project file is **trusted** when its SHA-256 is recorded for its path in `~/.pi/agent/extensions/sandbox.trust.json`, and the user did not decline pi's project trust. Any change to the file makes it untrusted again.
- **Untrusted**, both layers apply only what tightens (`lib/project-trust.ts`, `applyUntrustedProject`): `denyRead`, `modelDenyRead`, `denyWrite` and `network.deniedDomains` are added to the user's lists; `subagent.network` and `filesystem.outsideProject.read` apply only when stricter. Every other key is ignored and reported.
- **Trusted**, the file merges as before.
- `/security trust` shows the keys that trusting would apply and asks (pre-selected "no"); `/security untrust` forgets the file. `/security` shows the state.
- pi-secure-it's own "always for CURRENT project" grants record the new hash after writing, but only into a file that was already trusted (or did not exist). Into an untrusted file they are refused, so a grant can never launder content the user did not review.
- Layer 2 warns at session start and audits `untrusted-project-policy` with the ignored keys.

## Consequences

- A repository can add protections but cannot lower them without the user's explicit, content-pinned consent.
- Existing project files, including ones pi-secure-it wrote, are untrusted after upgrading; their loosening keys apply after one `/security trust` per project. This is a breaking change.
- The trust store lives outside every project; the default `allowWrite` roots do not cover it. Adding `~/.pi/agent/extensions/**` to `denyWrite` (as the example config does) protects it from the agent as well.
