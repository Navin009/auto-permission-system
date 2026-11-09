# ADR-043: The question and note are fixed rows, not part of the scroll

**Status:** Accepted

## Context

Every ask prompt is a `title` string that `AskSelector` splits into a header
(first line) and a body (the rest). The Advanced Secure evidence prompt
(ADR-018, ADR-042) built that string as:

```text
⚠  Sensitive information detected
<blank>
Tool     bash (ps aux | grep node)
Finding  1: <the whole matched line>
<blank>
Question Should the AI be allowed to see it?
<blank>
Note     you'll be asked again each time a secret shows up
```

ADR-041/042 made the body a scrolling viewport of wrapped rows. That turned the
question and the note into ordinary body rows, with two consequences a user
reported immediately:

1. **The question scrolled away.** With a 5,500-char evidence line the body is
   ~35 rows; the question sat at row 38 of the viewport, so the choices were
   presented with no visible question until you paged to the end — and paging
   back to double-check hid it again.
2. **The spacing was ragged.** The separator lines were *content*, so blank rows
   appeared and vanished mid-scroll, and the gap between the body and the
   choices depended on how much text happened to be in the evidence.

The question is not evidence. It is the thing being asked, and it must stay
next to the choices.

## Decision

- **`AskSelector` takes `question` and `note` as their own options.** They render
  as fixed rows between the body viewport (with its indicator) and the choices,
  so no amount of scrolling moves them.
- **Separators are widgets, not text.** The gaps around the header, the body and
  the choices are `Spacer` children, and `trimBlankEdges` drops blank first/last
  body lines, so one blank line appears in exactly one place no matter how the
  caller writes the title. Ragged spacing can no longer come from content.
- **The gap before the choices is permanent.** The `Default: …` line keeps its
  own row and hides on engagement (ADR-039), but the spacer that follows it does
  not, so the options do not jump up when the countdown ends.
- **The non-TUI fallback keeps the flat text.** `ui.select` has no slots, so
  `askWithSelect` appends `question` and `note` to the title exactly as before;
  RPC, print and the contract tests see the same text they always did.
- **Chrome accounting follows.** `bodyBudget` now reserves the question and note
  rows (`extraChromeRows`) plus six spacers, one footer row and one help row, so
  the viewport shrinks when a prompt carries more fixed furniture.

## Consequences

- The question, the note, the options and the help line are visible in every
  scroll position; the evidence is the only thing that moves.
- Prompts without a question/note (file, network, MCP asks) render exactly as
  before, one blank line between header and body.
- Widget height shrinks by one row when the footer hides, and by nothing else.
- `security/tests/unit/ask-selector.mjs` locks it: the question and note survive
  scrolling, the question sits above the choices, and the widget still fits the
  terminal with both fixed rows present.
