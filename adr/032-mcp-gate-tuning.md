# ADR-032: MCP gate tuning and the `mcp` policy section

**Status:** Accepted

## Context

Advanced Secure classifies every `mcp__<server>__<tool>` call before it runs
(ADR-018). A corpus of 420 real tool definitions from eight MCP servers
(grafana, facebook_ads, dev_link, ticktick, chrome_devtools, argocd,
diffusion_studio, tinyfish) measured the gate: **336 of 420 calls (80%) were
asked**, including ordinary reads. The audit log showed the same on live
servers — `mcp__facebook_ads__ads_get_ad_accounts` was classified *destructive*
and `mcp__diffusion_studio__context`, `logs`, `media_waveform`, and
`export` were all asked.

Root causes, in order of impact:

1. `classifyDescription` took the **strongest verb anywhere in the prose**. A
   description saying "returns the result in JSON **format**" or "the list is
   **empty**" classified the tool destructive (`format` = 80, `empty` = 55,
   scaled ×0.7 → 56/39, both above the threshold).
2. The **server namespace was tokenized as the operation**:
   `mcp__dev_link__search_tools` hit `link` (mutating), `mcp__facebook_ads__…`
   hit `ads`, and so on.
3. An **unknown name defaulted to 45** — above the 30 threshold — so every
   tool without a recognized verb in its name asked, even a documented read
   like `context` or `capture`.
4. Non-head verbs are usually **nouns**: `list_tags` (`tag`), 
   `list_product_sets` (`set`), `list_provisioning_repositories`
   (`provisioning`) were all classified as writes.
5. Argument/schema signals were too broad: `"all"` was a wildcard value (so
   `filter: "all"` forced a destructive ask), `live` was a production token (so
   `src/live/handler.ts` bumped the score), `filter` was a bulk key, and enum
   members were scanned as if they were the call's values.

The gate's policy surface (`McpPolicy`: allow/ask lists, annotation trust,
threshold) existed since ADR-018 but was never wired: the guard called
`evaluateMcpCall` without a policy, so none of it could be configured.

## Decision

### Classification

- Strip the `mcp__<server>__` prefix before tokenizing the name. The server
  name says nothing about the operation.
- For **names**: a destructive verb counts anywhere (it is never a noun:
  `product_feed_delete_rule` deletes). Every other verb must be a head verb —
  the first verb hit within the first 3 tokens (`ads_get_ad_accounts`,
  `ads_catalog_update_product`, `ads_experiment_abtest_create_test`). Later
  verbs are nouns or gerund modifiers and no longer classify the call.
- For **descriptions**: only the first verb within the first 5 tokens
  classifies. Prose ("JSON format", "the empty list", "call delete_tag to…")
  describes results and other tools, not this operation.
- The unknown base score drops from 45 to **25** (below the threshold), so a
  documented tool with an unclassified name does not ask. A tool with **no
  description at all** adds +20 and still asks: a black box fails closed.
- Destructive argument evidence (wildcard target, SQL destructive or `UPDATE`
  without `WHERE`, shell destructive, HTTP `DELETE`) reclassifies the result as
  destructive, so a `read_query` tool handed `DELETE FROM users` asks and reads
  as destructive on the prompt.

### Signals

- `all` and `-1` are no longer wildcard values; `filter`/`filters` are no
  longer bulk keys; enum members are no longer scanned as call values.
- Only `prod`/`production`/`prd` count as production targets. `live` is an
  everyday word (live streams, `src/live/`).
- A few risky head verbs are added (`run`, `execute`, `evaluate`, mutating 30)
  and `discover`/`cancel` join the read/operational sets. A `read_*` prefix
  still wins as the head verb.

### Policy

- `sandbox.json` gains an optional `mcp` object, wired into the guard:
  `allowTools`, `allowPrefixes`, `askTools`, `trustAnnotations`,
  `allowSimpleUpdates`, `askThreshold`. It layers like every other key
  (shipped default < global < project).
- An **untrusted** project file may only tighten: it may add `askTools`,
  lower `askThreshold`, and turn `allowSimpleUpdates`/`trustAnnotations` off.
  Allow lists and a raised threshold are ignored and reported in the trust
  warning.
- A name in both `askTools` and `allowTools` asks: a contradictory entry fails
  toward the prompt.

## Consequences

- On the 420-tool corpus the gate drops from **336 asks to 119**, and every
  remaining ask is a real delete, create, or update. The fixture holds 19 real
  definitions as regression tests (`security/tests/unit/mcp-gate.mjs`).
- The gate is now tunable: a user with a verbose server adds
  `mcp.allowPrefixes` / `mcp.allowTools` instead of turning the mode off.
  Explicit allow lists can cover a destructive tool — a deliberate user
  override, documented.
- Annotations stay untrusted by default (a server can lie about
  `readOnlyHint`); `trustAnnotations` opts in. Destructive evidence still wins
  over a read-only hint.
- A documented but unclassified tool whose actual operation is risky (for
  example `argocd_run_resource_action`) starts below the threshold; its
  arguments usually carry the risk (`method`, `command`, wildcards) and the
  policy lists cover the rest. A tool with no description still asks.
- Both tuning layers ship as tests: gate behavior, and untrusted-project
  handling of the `mcp` section.
