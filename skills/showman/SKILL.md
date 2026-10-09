---
name: showman
description: Show documents to the user in their browser — renders HTML as-is, JSON as an interactive collapsible tree, and Markdown as styled HTML with syntax highlighting. Use whenever a document, spec, report, plan, or data needs visual review, feedback, or approval in a browser tab.
---

# Showman — put it in the browser

One tool, three formats. The extension runs a localhost HTTP server
(lazy-started, random port, dies with the session), stores documents by UUID,
and opens the user's default browser.

## When to call it

- A spec, plan, or report needs the user's **review, feedback, or approval**
- A data structure is easier to explore than to read (JSON → tree)
- Generated HTML should be seen rendered, not as source
- Prompt templates or skills instruct a document handoff

## How to call it

`show_in_browser` takes exactly one of:

- `content` — raw string, plus `format: "html" | "json" | "markdown"`
- `filePath` — format auto-detects from the extension (.md/.json/.html)
- Optional `title` for the browser tab

## House rules

1. **Always say WHY you're showing it** — feedback, approval, corrections,
   or next steps the user should take.
2. **Point at the key sections** — "check section 3 (token flow)" beats
   "here's the doc".
3. Documents stay re-openable this session via the `/docs` command; users can
   also open files directly with `/show-doc <path>`.
