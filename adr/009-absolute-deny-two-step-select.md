# ADR-009: Two-step select replaces the typed confirmation for the absolute-deny tier

**Status:** Accepted. Amends ADR-004 (the confirmation step only).

## Context

ADR-004 asked the user to type `"i understand"` to allow one call on credential material. It works, but it is slow and awkward for a step that legitimately happens, and the friction it adds is the same every time. The goal of ADR-004 is narrower than "make it hard": a reflexive keypress or a prompt-injected "just approve it" must not open credential material.

pi's `ctx.ui.confirm` is not a fit for this: it renders a Yes/No menu with **Yes listed first and pre-selected**, so Enter-Enter would approve.

## Decision

Allowing one absolute-deny call takes two `ctx.ui.select` steps, each with the blocking option first and pre-selected:

1. `no — block (default)` / `allow this ONE call` (60 s timeout, timeout blocks)
2. `Really allow <tool> on credential material? <path>`: `No — keep it blocked (default)` / `Yes — allow this ONE call` (30 s timeout, timeout blocks)

Everything else in ADR-004 stays: the tier is hardcoded, "always" is never offered, and headless mode (`ctx.hasUI === false`) blocks without asking.

## Consequences

- Approving needs two deliberate moves off the default; Enter-Enter, Escape or a timeout blocks.
- No typing. Weaker than a typed phrase against a user who has built the muscle memory "down, enter, down, enter"; accepted for the comfort gain.
- The prompt and the second step both show the canonical path, so the user approves the resolved target, not the path the model wrote (ADR-006).
