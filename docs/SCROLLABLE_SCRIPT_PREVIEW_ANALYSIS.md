# Simple Scrollable Script Prompt

## 1. Minimal Terminal View

No extra borders, no extra footer hints, no extra options. Only the prompt, the scrollable code, and your standard choices:

```text
Run python3 script.py?

import os
import sys
import requests

def fetch_data():
    r = requests.get("https://api.example.com")
    return r.json()

if __name__ == "__main__":
    fetch_data()

→ No
  Yes
```

When the script is long (e.g. 100+ lines), the upper code portion stays bounded (e.g. 10 lines) and scrolls with `PgUp` / `PgDn`, while `No` and `Yes` stay visible at the bottom.

---

## 2. Real Behavior Walkthrough

### State 1: Viewing Initial Lines

```text
Run python3 long_script.py?

import os
import sys
import requests

def step_one():
    print("Connecting...")
    token = os.getenv("API_KEY")

→ No
  Yes
```

---

### State 2: Scrolled Down (Using `PgDn`) — Options Stay at the Bottom

```text
Run python3 long_script.py?

def step_two():
    print("Processing...")
    for item in range(100):
        save_record(item)

if __name__ == "__main__":
    step_one()
    step_two()

→ No
  Yes
```

---

## 3. Minimal Component Code

```typescript
import {
  Container,
  SelectList,
  Spacer,
  Text,
} from "@earendil-works/pi-tui";

export class SimpleScrollablePrompt extends Container {
  private readonly lines: string[];
  private readonly maxVisible: number;
  private scrollOffset = 0;

  private codeViewText: Text;
  private selectList: SelectList;

  constructor(opts: {
    title: string;
    code: string;
    options: string[]; // e.g. ["No", "Yes"]
    maxLines?: number; // default: 10 lines
    tui: { requestRender(): void };
    theme: { fg(color: string, text: string): string };
    onSelect: (option: string) => void;
    onCancel: () => void;
  }) {
    super();
    this.lines = opts.code.split("\n");
    this.maxVisible = opts.maxLines ?? 10;

    // 1. Title
    this.addChild(new Text(opts.title, 0, 0));
    this.addChild(new Spacer(1));

    // 2. Scrollable Code View
    this.codeViewText = new Text(this.getSlice(), 0, 0);
    this.addChild(this.codeViewText);
    this.addChild(new Spacer(1));

    // 3. Options (e.g. No / Yes)
    this.selectList = new SelectList(
      opts.options.map((opt) => ({ value: opt, label: opt })),
      opts.options.length,
      {
        selectedPrefix: (t) => opts.theme.fg("accent", "→ "),
        selectedText: (t) => opts.theme.fg("accent", t),
        description: (t) => opts.theme.fg("muted", t),
        scrollInfo: (t) => opts.theme.fg("muted", t),
        noMatch: (t) => opts.theme.fg("muted", t),
      }
    );
    this.selectList.onSelect = (item) => opts.onSelect(item.value);
    this.selectList.onCancel = () => opts.onCancel();
    this.addChild(this.selectList);
  }

  private getSlice(): string {
    return this.lines
      .slice(this.scrollOffset, this.scrollOffset + this.maxVisible)
      .join("\n");
  }

  private scroll(delta: number, requestRender: () => void): void {
    const maxOffset = Math.max(0, this.lines.length - this.maxVisible);
    const next = Math.max(0, Math.min(maxOffset, this.scrollOffset + delta));
    if (next !== this.scrollOffset) {
      this.scrollOffset = next;
      this.codeViewText.setText(this.getSlice());
      requestRender();
    }
  }

  handleInput(data: string, requestRender: () => void): void {
    // PgUp / PgDn scroll the upper code
    if (data === "\x1b[5~") {
      this.scroll(-this.maxVisible, requestRender);
      return;
    }
    if (data === "\x1b[6~") {
      this.scroll(this.maxVisible, requestRender);
      return;
    }

    // Up / Down / Enter / Esc control the options list
    this.selectList.handleInput(data);
  }

  handleMouse(): undefined {
    return undefined;
  }
}
```
