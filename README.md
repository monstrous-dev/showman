# Showman for pi

*Stop pasting documents into chat. Showman puts them in the browser — rendered,
interactive, and review-ready.*

A [pi](https://pi.dev) extension that renders and displays HTML, JSON, and
Markdown documents in the user's browser. It manages a local HTTP server,
auto-opens the default browser, and tracks document history for the session.

```bash
pi install git:github.com/monstrous-dev/showman
```

## Quick reference

| Interface | Description |
|---|---|
| `show_in_browser` tool | LLM-callable tool — the agent uses this to share documents with the user |
| `/show-doc <path>` command | User / skill / template command to open a file in the browser |
| `/docs` command | List and re-open documents from the current session |
| `showInBrowser()` function | Exported helper for programmatic use from other extensions |

## Format support

### HTML (`format: "html"`)

Served as-is — no transformation, no wrapping. Complete pages, custom
interactive documents, pre-rendered content.

### JSON (`format: "json"`)

An **interactive collapsible tree**: color-coded value types, collapsible
nodes (auto-collapses past depth 2), dark terminal-inspired theme, type badges
for array lengths and key counts.

### Markdown (`format: "markdown"`)

Styled HTML with GFM support, syntax-highlighted code blocks (highlight.js,
loaded client-side), clean neutral typography, tables, blockquotes, lists,
images, horizontal rules.

## Usage

### 1. LLM tool — `show_in_browser`

| Parameter | Type | Required* | Description |
|---|---|---|---|
| `format` | `"html" \| "json" \| "markdown"` | Yes* | Content format; auto-detects from `filePath` |
| `content` | `string` | No* | Raw content string |
| `filePath` | `string` | No* | Path to a file to read and render |

\* Exactly one of `content` / `filePath`.

The tool carries prompt guidelines that make the agent explain **why** it's
showing the document and which sections deserve the user's attention — not
just drop a link.

### 2. Command — `/show-doc`

```
/show-doc path/to/spec.md
/show-doc path/to/data.json
/show-doc --format json --content '{"key": "value"}'
```

Auto-detects format from the extension: `.json`/`.jsonl` → JSON tree,
`.md`/`.mdx`/`.markdown` → Markdown, anything else → HTML passthrough.

### 3. Command — `/docs`

Interactive picker over every document opened this session; select one to
re-open it.

### 4. Programmatic API — `showInBrowser()`

Other extensions can import and call the exported function:

```typescript
import { showInBrowser, type ShowOptions, type ShowResult }
  from "../show-in-browser/index.ts"; // sibling local extension

const result = await showInBrowser({
  format: "json",
  content: JSON.stringify({ users: [{ name: "Ada" }] }),
});
console.log(result.url); // http://127.0.0.1:9174/doc/<uuid>
```

`ShowOptions`: `format?`, `content?`, `filePath?`, `title?`.
`ShowResult`: `{ id, url, title }`.

The server and document history are shared across all callers in a session.

## Install

```bash
pi install git:github.com/monstrous-dev/showman
```

Try it without installing:

```bash
pi -e git:github.com/monstrous-dev/showman
```

## Updates

```bash
pi update --extensions          # reconcile all packages
pi update git:github.com/monstrous-dev/showman   # just Showman
```

Installed without a ref you track `main`; releases are git tags. Pin one:

```bash
pi install git:github.com/monstrous-dev/showman@v0.1.0
```

## How it works

- **Lazy HTTP server** — starts on first use, binds `127.0.0.1` on an
  OS-assigned port, shuts down with the session. Routes: `GET /doc/:id`,
  `GET /` (index of the session's documents).
- **Browser opening** — system default: `start` / `open` / `xdg-open`.
- **Document lifecycle** — read → format → render to HTML → store in memory
  under a UUID → open the URL. Re-viewable via `/docs` until the session ends.
- **Zero Node dependencies** — Markdown rendering and syntax highlighting load
  client-side from CDN in the generated page; the extension itself is one
  TypeScript file plus pi's SDK types.

## Security

Showman serves documents to `127.0.0.1` only and stores them in memory for the
session. Whatever the agent shows you is written nowhere on disk by this
extension. Review the source — it's one small file.

## License

[MIT](LICENSE)
