# Implementation Plan: Scrollable Code Preview with Sticky Options

## 1. Goal
When an AI agent prompts the user to execute or allow a long script (or bash command), keep the exact same existing options (`No`, `Yes, just this once`, `Yes, for this conversation`, etc.) fixed and visible at the bottom of the screen, while making the upper body / code portion scrollable with `PgUp` / `PgDn`.

No extra option changes, no extra borders, no noisy boxes. Only make the code preview scrollable in place with clean space separation.

---

## 2. Touch Points in Codebase

| File | Current Behavior | Target Change |
| --- | --- | --- |
| **`src/ui/ask-selector.ts`** | Renders static `Text` component for the whole `title` (header + body). Overflow lines get pushed off screen. | Split `title` into non-scrolling header and bounded scrollable body (`scrollOffset` + `PgUp`/`PgDn` handling). |
| **`src/ui/ask-flow.ts`** | Pass optional `scrollable` content / max visible rows to `askSelect` / `AskSelectorOptions`. | Pass script/body content separately or allow `AskSelector` to auto-window bodies exceeding max lines. |
| **`security/tests/unit/ask-selector.mjs`** | Tests `AskSelector` keyboard events, timeout, countdown, and selection. | Add tests for `PgUp` / `PgDn` scroll offset bounds. |

---

## 3. Step-by-Step Implementation Steps

### Step 1: Update `AskSelectorOptions` in `src/ui/ask-selector.ts`
Add optional properties for scroll configuration while maintaining full backward compatibility:
```typescript
export type AskSelectorOptions = {
    title: string;
    /** Optional script/code body to render in a scrollable window */
    body?: string;
    /** Max lines visible in the scrollable viewport (default: 10-12) */
    maxBodyLines?: number;
    footer: string | null;
    options: string[];
    timeoutMs: number;
    tui: { requestRender(): void };
    theme: AskTheme;
    keybindings: { matches(data: string, action: string): boolean };
    done: (result: string | undefined) => void;
    onExpire: () => void;
    tickMs?: number;
};
```

### Step 2: Implement Scroll Viewport in `AskSelector`
In `AskSelector`:
1. Store body lines:
   ```typescript
   private bodyLines: string[] = [];
   private scrollOffset = 0;
   private maxBodyLines = 10;
   private bodyText: Text | null = null;
   ```
2. If `body` is provided (or if `title` contains multiline body content), slice the visible lines:
   ```typescript
   private getVisibleBody(): string {
       return this.bodyLines
           .slice(this.scrollOffset, this.scrollOffset + this.maxBodyLines)
           .join("\n");
   }
   ```
3. Add `scroll(delta: number)`:
   ```typescript
   private scroll(delta: number): void {
       if (this.bodyLines.length <= this.maxBodyLines) return;
       const maxOffset = this.bodyLines.length - this.maxBodyLines;
       const next = Math.max(0, Math.min(maxOffset, this.scrollOffset + delta));
       if (next !== this.scrollOffset) {
           this.scrollOffset = next;
           this.bodyText?.setText(this.getVisibleBody());
           this.tui.requestRender();
       }
   }
   ```
4. Intercept `PgUp` (`\x1b[5~`) and `PgDn` (`\x1b[6~`) in `handleInput(data)`:
   ```typescript
   handleInput(data: string): void {
       if (data === "\x1b[5~") { // PgUp
           this.scroll(-this.maxBodyLines);
           return;
       }
       if (data === "\x1b[6~") { // PgDn
           this.scroll(this.maxBodyLines);
           return;
       }
       if (this.keybindings.matches(data, "tui.select.up")) {
           this.move(-1);
           return;
       }
       if (this.keybindings.matches(data, "tui.select.down")) {
           this.move(1);
           return;
       }
       this.list.handleInput(data);
   }
   ```

### Step 3: Keep Options Unchanged
The `SelectList` initialization remains exactly as it is:
- The options (`No`, `Yes, just this once`, `Yes, for this conversation`, `Yes, always...`) and pre-selection logic are untouched.
- `SelectList` sits below the scrollable body, separated by `Spacer(1)`.

### Step 4: Update Unit & Contract Tests
Run:
```bash
npm run typecheck
node security/tests/unit/ask-selector.mjs
```
Verify:
1. Short text prompts continue to behave identically.
2. Long scripts stay clamped to `maxBodyLines`.
3. `PgUp` / `PgDn` scroll the script viewport while `↑` / `↓` navigate the exact same options.

---

## 4. Visual Verification (What User Sees)

```text
Allow python3 run_analysis.py?

import os
import sys
import requests

def fetch_data():
    token = os.getenv("SECRET")
    return requests.get("https://internal.api")

→ No
  Yes, just this once
  Yes, for this conversation
  Yes, always…
```

Pressing `PgDn`:
```text
Allow python3 run_analysis.py?

def process():
    for item in range(100):
        upload(item)

if __name__ == "__main__":
    fetch_data()
    process()

→ No
  Yes, just this once
  Yes, for this conversation
  Yes, always…
```
