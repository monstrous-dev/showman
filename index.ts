/**
 * Show in Browser - Pi Extension
 *
 * Renders and displays HTML, JSON, and Markdown documents in the user's browser.
 * Provides:
 *  - `show_in_browser` tool (LLM-callable)
 *  - `/show-doc` command (user / skill / template callable)
 *  - exported `showInBrowser()` helper for other extensions
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { resolve, extname } from "node:path";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A stored document served by the local HTTP server. */
export interface DocEntry {
	/** Unique document ID (UUID). */
	id: string;
	/** Auto-generated or custom display title. */
	title: string;
	/** Content format used for rendering. */
	format: "html" | "json" | "markdown";
	/** Rendered HTML content served by the server. */
	content: string;
	/** Unix timestamp (ms) when the document was created. */
	createdAt: number;
}

/** Options for {@link showInBrowser}. */
export interface ShowOptions {
	/**
	 * Content format for rendering.
	 * - `"html"` - served as-is (no transformation).
	 * - `"json"` - rendered as an interactive collapsible tree with syntax-colored values.
	 * - `"markdown"` - rendered as styled HTML with syntax-highlighted code blocks.
	 *
	 * If omitted, auto-detected from `filePath` extension, or defaults to `"html"`.
	 */
	format?: "html" | "json" | "markdown";
	/**
	 * Raw content string to render.
	 * Mutually exclusive with `filePath` - provide one or the other.
	 */
	content?: string;
	/**
	 * Path to a file to read and render.
	 * Mutually exclusive with `content` - provide one or the other.
	 * Supports absolute and relative (cwd-based) paths.
	 */
	filePath?: string;
	/**
	 * Custom browser tab title. If omitted, auto-generated from format + timestamp
	 * (e.g. `"JSON Viewer - 14:32"`).
	 */
	title?: string;
}

/** Result returned by {@link showInBrowser}. */
export interface ShowResult {
	/** Unique document ID (UUID). */
	id: string;
	/** Full URL where the document is served (e.g. `http://127.0.0.1:9174/doc/<uuid>`). */
	url: string;
	/** The display title used for the browser tab. */
	title: string;
}

// ---------------------------------------------------------------------------
// JSON Tree Viewer HTML
// ---------------------------------------------------------------------------

function buildJsonTreeHtml(jsonContent: string, title: string): string {
	// Validate JSON first
	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonContent);
	} catch {
		parsed = jsonContent;
	}

	const escapedJson = jsonContent
		.replace(/\\/g, "\\\\")
		.replace(/`/g, "\\`")
		.replace(/\$/g, "\\$");

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 20px; }
  .header { margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #333; }
  .header h1 { font-size: 16px; font-weight: 600; color: #90caf9; }
  .header span { font-size: 12px; color: #888; }
  #tree { font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace; font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; }
  .node { padding-left: 20px; }
  .node.collapsed > .children { display: none; }
  .toggle { cursor: pointer; user-select: none; display: inline-block; width: 16px; color: #666; }
  .toggle:hover { color: #90caf9; }
  .key { color: #ce93d8; }
  .colon { color: #666; }
  .str { color: #a5d6a7; }
  .num { color: #ffcc80; }
  .bool { color: #80deea; }
  .null { color: #ef9a9a; font-style: italic; }
  .bracket { color: #888; }
  .type-badge { font-size: 10px; padding: 1px 4px; border-radius: 3px; margin-left: 6px; background: #2a2a4a; color: #888; vertical-align: middle; }
</style>
</head>
<body>
<div class="header">
  <h1>${escHtml(title)}</h1>
  <span>JSON Tree Viewer &middot; ${new Date().toLocaleString()}</span>
</div>
<div id="tree"></div>
<script>
const data = ${JSON.stringify(parsed)};

function typeBadge(val) {
  if (val === null) return '<span class="type-badge">null</span>';
  if (Array.isArray(val)) return '<span class="type-badge">array[' + val.length + ']</span>';
  const t = typeof val;
  if (t === 'object') return '<span class="type-badge">object{' + Object.keys(val).length + '}</span>';
  return '';
}

function renderValue(val, depth) {
  if (val === null) return '<span class="null">null</span>';
  if (typeof val === 'string') return '<span class="str">' + esc(JSON.stringify(val)) + '</span>';
  if (typeof val === 'number') return '<span class="num">' + val + '</span>';
  if (typeof val === 'boolean') return '<span class="bool">' + val + '</span>';
  return '';
}

function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function renderNode(val, depth) {
  if (val === null || typeof val !== 'object') return renderValue(val, depth);

  const isArr = Array.isArray(val);
  const entries = isArr ? val.map((v,i) => [i,v]) : Object.entries(val);
  const open = isArr ? '[' : '{';
  const close = isArr ? ']' : '}';
  const collapsed = depth > 2;

  if (entries.length === 0) {
    return '<span class="bracket">' + open + close + '</span>';
  }

  let html = '<span class="toggle">' + (collapsed ? '&#9654;' : '&#9660;') + '</span>';
  html += '<span class="bracket">' + open + '</span>' + typeBadge(val);
  html += '<div class="node' + (collapsed ? ' collapsed' : '') + '"><div class="children">';

  for (const [key, value] of entries) {
    const keyLabel = isArr ? '<span class="num">' + key + '</span>' : '<span class="key">"' + esc(String(key)) + '"</span>';
    html += '<div>' + keyLabel + '<span class="colon">: </span>' + renderNode(value, depth + 1) + '</div>';
  }

  html += '</div></div><span class="bracket">' + close + '</span>';
  return html;
}

document.getElementById('tree').innerHTML = renderNode(data, 0);

document.getElementById('tree').addEventListener('click', (e) => {
  const toggle = e.target.closest('.toggle');
  if (!toggle) return;
  const node = toggle.parentElement;
  if (!node) return;
  node.classList.toggle('collapsed');
  toggle.innerHTML = node.classList.contains('collapsed') ? '&#9654;' : '&#9660;';
});
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Markdown → HTML renderer
// ---------------------------------------------------------------------------

function buildMarkdownHtml(mdContent: string, title: string): string {
	// Embed markdown as JSON in a script tag, render client-side with marked.js
	// This avoids jiti transpilation bugs with server-side normalizeMarkdown
	const mdJson = JSON.stringify(mdContent);

	return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)}</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></scri` + `pt>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11/styles/github.min.css" media="all" id="hljs-light" disabled>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11/styles/github-dark.min.css" media="all" id="hljs-dark" disabled>
<script src="https://cdn.jsdelivr.net/npm/highlight.js@11/highlight.min.js"></scri` + `pt>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;600;700&amp;family=Figtree:wght@400;500;600;700&amp;family=Jost:wght@400;500;600;700&amp;family=Lexend:wght@400;500;600;700&amp;family=Libre+Franklin:wght@400;600;700;800&amp;family=Manrope:wght@400;500;600;700;800&amp;family=Overpass:wght@400;500;600;700&amp;family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&amp;family=Sora:wght@400;600;700;800&amp;display=swap" rel="stylesheet">
<style>
:root {
  --bg: #ffffff;
  --surface: #f6f8fa;
  --surface-hover: #eaeef2;
  --border: #d0d7de;
  --text: #1f2328;
  --text-secondary: #656d76;
  --accent: #0969da;
  --accent-hover: #0550ae;
  --code-bg: #f6f8fa;
  --code-text: #1f2328;
  --pre-bg: #ffffff;
  --quote-border: #d0d7de;
  --quote-bg: #f6f8fa;
  --table-stripe: #f6f8fa;
  --link: #0969da;
  --hr: #d8dee4;
  --danger: #cf222e;
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
html[data-theme="dark"] {
  --bg: #0d1117;
  --surface: #161b22;
  --surface-hover: #1c2128;
  --border: #30363d;
  --text: #e6edf3;
  --text-secondary: #8b949e;
  --accent: #58a6ff;
  --accent-hover: #79c0ff;
  --code-bg: #161b22;
  --code-text: #e6edf3;
  --pre-bg: #0d1117;
  --quote-border: #30363d;
  --quote-bg: #161b22;
  --table-stripe: #161b22;
  --link: #58a6ff;
  --hr: #21262d;
  --danger: #f85149;
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-text-size-adjust: 100%; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.7;
  color: var(--text);
  background: var(--bg);
  min-height: 100vh;
}
.container {
  max-width: 980px;
  margin: 0 auto;
  padding: 40px 32px 80px;
}
.md-body h1,
.md-body h2,
.md-body h3,
.md-body h4,
.md-body h5,
.md-body h6 {
  margin-top: 24px;
  margin-bottom: 16px;
  font-weight: 600;
  line-height: 1.25;
}
.md-body h1 {
  font-size: 2em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--hr);
}
.md-body h2 {
  font-size: 1.5em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--hr);
}
.md-body h3 { font-size: 1.25em; }
.md-body h4 { font-size: 1em; }
.md-body h5 { font-size: 0.875em; }
.md-body h6 { font-size: 0.85em; color: var(--text-secondary); }
.md-body h1:first-child,
.md-body h2:first-child,
.md-body h3:first-child { margin-top: 0; }
.md-body p { margin-bottom: 16px; }
.md-body a { color: var(--link); text-decoration: none; }
.md-body a:hover { text-decoration: underline; }
.md-body strong { font-weight: 600; }
.md-body del { text-decoration: line-through; color: var(--text-secondary); }
.md-body ul, .md-body ol { margin-bottom: 16px; padding-left: 2em; }
.md-body ul { list-style-type: disc; }
.md-body ol { list-style-type: decimal; }
.md-body li { margin-bottom: 4px; }
.md-body li > p { margin-bottom: 8px; }
.md-body li > ul, .md-body li > ol { margin-bottom: 4px; margin-top: 4px; }
.md-body blockquote {
  margin: 0 0 16px;
  padding: 8px 16px;
  border-left: 4px solid var(--quote-border);
  background: var(--quote-bg);
  color: var(--text-secondary);
}
.md-body blockquote p:last-child { margin-bottom: 0; }
.md-body code {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 85%;
  background: var(--code-bg);
  padding: 0.2em 0.4em;
  border-radius: 6px;
  color: var(--code-text);
}
.md-body pre {
  margin-bottom: 16px;
  padding: 16px;
  overflow: auto;
  border-radius: 8px;
  background: var(--pre-bg);
  border: 1px solid var(--border);
  line-height: 1.5;
}
.md-body pre code {
  display: block;
  background: none;
  padding: 0;
  border-radius: 0;
  font-size: 13px;
  white-space: pre;
  word-wrap: normal;
}
.md-body table {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: 16px;
  overflow: auto;
}
.md-body th, .md-body td {
  border: 1px solid var(--border);
  padding: 8px 13px;
}
.md-body th { font-weight: 600; background: var(--surface); }
.md-body tr:nth-child(even) td { background: var(--table-stripe); }
.md-body hr {
  border: none;
  border-top: 2px solid var(--hr);
  margin: 24px 0;
}
.md-body img {
  max-width: 100%;
  border-radius: 8px;
  margin: 8px 0;
}
.md-body input[type="checkbox"] {
  margin-right: 6px;
  accent-color: var(--accent);
}
/* Theme toggle */
.theme-toggle {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 50;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  box-shadow: var(--shadow);
  transition: background 0.15s;
  font-size: 13px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.theme-toggle:hover { background: var(--surface-hover); }
.theme-toggle svg { width: 16px; height: 16px; }
@media (max-width: 768px) {
  .container { padding: 24px 16px 60px; }
}
@media print {
  .container { padding: 20px; max-width: 100%; }
  pre { white-space: pre-wrap; }
  .theme-toggle { display: none; }
}
</style>
</head>
<body>
<div class="container">
  <article class="md-body" id="output"></article>
</div>
<button class="theme-toggle" id="themeToggle" title="Toggle theme">
  <svg id="themeIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
</button>
<script type="application/json" id="md-source">${mdJson}</script>
<script>
(function() {
  var SUN_PATH = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
  var MOON_PATH = '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>';
  var hljsLight = document.getElementById('hljs-light');
  var hljsDark = document.getElementById('hljs-dark');
  var themeIcon = document.getElementById('themeIcon');
  var themeToggle = document.getElementById('themeToggle');

  function getStoredTheme() {
    try { return localStorage.getItem('pi-mdv-theme') || 'light'; } catch(e) { return 'light'; }
  }
  function applyTheme(theme) {
    var html = document.documentElement;
    html.setAttribute('data-theme', theme);
    var isDark = theme === 'dark';
    hljsLight.disabled = isDark;
    hljsDark.disabled = !isDark;
    themeIcon.innerHTML = isDark ? SUN_PATH : MOON_PATH;
    themeToggle.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  }
  function cycleTheme() {
    var current = getStoredTheme();
    var next = current === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('pi-mdv-theme', next); } catch(e) {}
    applyTheme(next);
  }
  applyTheme(getStoredTheme());
  themeToggle.addEventListener('click', cycleTheme);

  // --- Client-side markdown rendering ---
  var mdSource = JSON.parse(document.getElementById('md-source').textContent);
  var output = document.getElementById('output');
  if (typeof marked !== 'undefined') {
    marked.setOptions({ gfm: true, breaks: false });
    output.innerHTML = marked.parse(mdSource);
  } else {
    output.textContent = mdSource;
  }

  // Syntax highlighting
  if (typeof hljs !== 'undefined') {
    document.querySelectorAll('.md-body pre code').forEach(function(block) {
      hljs.highlightElement(block);
    });
  }

  // Open all links in new tab
  document.querySelectorAll('.md-body a').forEach(function(a) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
})();
</script>
</body>
</html>`;
}
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

function escHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function detectFormat(filePath: string): "json" | "markdown" | "html" {
	const ext = extname(filePath).toLowerCase();
	if (ext === ".json" || ext === ".jsonl") return "json";
	if (ext === ".md" || ext === ".mdx" || ext === ".markdown") return "markdown";
	if (ext === ".html" || ext === ".htm") return "html";
	return "html";
}

function autoTitle(format: string): string {
	const now = new Date();
	const ts = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	const labels: Record<string, string> = {
		html: "HTML Document",
		json: "JSON Viewer",
		markdown: "Markdown Document",
	};
	return `${labels[format] ?? "Document"} - ${ts}`;
}

// ---------------------------------------------------------------------------
// Server manager
// ---------------------------------------------------------------------------

class DocServer {
	private server: Server | null = null;
	private port: number = 0;
	private docs = new Map<string, DocEntry>();
	private docOrder: string[] = [];

	async ensureStarted(): Promise<number> {
		if (this.server) return this.port;

		this.server = createServer((req, res) => this.handleRequest(req, res));

		const port = await new Promise<number>((resolvePort, reject) => {
			this.server!.listen(0, "127.0.0.1", () => {
				const addr = this.server!.address();
				if (addr && typeof addr === "object") {
					resolvePort(addr.port);
				} else {
					reject(new Error("Failed to get server port"));
				}
			});
			this.server!.on("error", reject);
		});

		this.port = port;
		return port;
	}

	addDoc(entry: DocEntry): void {
		this.docs.set(entry.id, entry);
		this.docOrder.push(entry.id);
	}

	getDocs(): DocEntry[] {
		return this.docOrder.map((id) => this.docs.get(id)!).filter(Boolean);
	}

	getDoc(id: string): DocEntry | undefined {
		return this.docs.get(id);
	}

	private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
		const path = url.pathname;

		// Route: /doc/:id - serve a document
		if (path.startsWith("/doc/")) {
			const id = path.slice(5);
			const entry = this.docs.get(id);
			if (!entry) {
				res.writeHead(404, { "Content-Type": "text/plain" });
				res.end("Document not found");
				return;
			}
			res.writeHead(200, {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-cache",
			});
			res.end(entry.content);
			return;
		}

		// Route: / - index page listing all documents
		if (path === "/" || path === "/index.html") {
			res.writeHead(200, {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-cache",
			});
			res.end(this.buildIndex());
			return;
		}

		res.writeHead(404, { "Content-Type": "text/plain" });
		res.end("Not found");
	}

	private buildIndex(): string {
		const docs = this.getDocs();
		let listHtml: string;

		if (docs.length === 0) {
			listHtml = '<p style="color:#888;">No documents opened yet.</p>';
		} else {
			listHtml = '<ul style="list-style:none;padding:0;">';
			for (const doc of docs) {
				const time = new Date(doc.createdAt).toLocaleTimeString([], {
					hour: "2-digit",
					minute: "2-digit",
					second: "2-digit",
				});
				const badge =
					doc.format === "json"
						? "📡"
						: doc.format === "markdown"
							? "📝"
							: "🌐";
				listHtml += `<li style="padding:8px 0;border-bottom:1px solid #eee;">
          <a href="/doc/${doc.id}" style="color:#1565c0;text-decoration:none;font-weight:500;">
            ${badge} ${escHtml(doc.title)}
          </a>
          <span style="color:#999;font-size:12px;margin-left:8px;">${time}</span>
        </li>`;
			}
			listHtml += "</ul>";
		}

		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Document Viewer</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fafafa; color: #333; padding: 40px; max-width: 720px; margin: 0 auto; }
  h1 { font-size: 20px; margin-bottom: 20px; color: #1a1a1a; border-bottom: 2px solid #e0e0e0; padding-bottom: 8px; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
<h1>📄 Documents</h1>
${listHtml}
</body>
</html>`;
	}

	shutdown(): void {
		if (this.server) {
			this.server.close();
			this.server = null;
			this.port = 0;
		}
		this.docs.clear();
		this.docOrder = [];
	}
}

// ---------------------------------------------------------------------------
// Shared server instance
// ---------------------------------------------------------------------------

const docServer = new DocServer();

// ---------------------------------------------------------------------------
// Core helper - exported for other extensions
// ---------------------------------------------------------------------------

/**
 * Render and open a document in the user's default browser.
 *
 * This is the core function powering the `show_in_browser` tool, the
 * `/show-doc` command, and any external extension that imports it.
 *
 * It handles:
 * 1. Reading content (from inline string or file path)
 * 2. Auto-detecting format from file extension (if not specified)
 * 3. Rendering to HTML (JSON tree, styled Markdown, or raw HTML passthrough)
 * 4. Starting the local HTTP server (lazy, on first call)
 * 5. Storing the document in session history
 * 6. Opening the browser
 *
 * @param options - See {@link ShowOptions} for all parameters.
 * @returns A {@link ShowResult} with the document ID, URL, and title.
 * @throws If neither `content` nor `filePath` is provided.
 * @throws If `filePath` points to a non-existent or unreadable file.
 *
 * @example
 * ```typescript
 * import { showInBrowser } from "./show-in-browser/index.ts";
 *
 * // Show inline JSON as an interactive tree
 * const result = await showInBrowser({
 *   format: "json",
 *   content: JSON.stringify({ users: [{ name: "Ada" }] }),
 * });
 * console.log(result.url); // http://127.0.0.1:9174/doc/<uuid>
 *
 * // Show a Markdown file with auto-detected format
 * await showInBrowser({ filePath: "./spec.md" });
 *
 * // Show raw HTML with a custom title
 * await showInBrowser({
 *   format: "html",
 *   content: "<h1>Hello</h1>",
 *   title: "My Report",
 * });
 * ```
 */
export async function showInBrowser(options: ShowOptions): Promise<ShowResult> {
	const { format, content, filePath, title: customTitle } = options;

	// Read content
	let rawContent: string;
	if (content && filePath) {
		throw new Error("'content' and 'filePath' are mutually exclusive — provide one, not both");
	} else if (content) {
		rawContent = content;
	} else if (filePath) {
		rawContent = await readFile(resolve(filePath), "utf-8");
	} else {
		throw new Error("Either 'content' or 'filePath' must be provided");
	}

	// Determine format
	const effectiveFormat = format ?? (filePath ? detectFormat(filePath) : "html");

	// Determine title
	const title = customTitle ?? autoTitle(effectiveFormat);

	// Build HTML content
	let htmlContent: string;
	switch (effectiveFormat) {
		case "json":
			htmlContent = buildJsonTreeHtml(rawContent, title);
			break;
		case "markdown":
			htmlContent = buildMarkdownHtml(rawContent, title);
			break;
		case "html":
		default:
			htmlContent = rawContent;
			break;
	}

	// Start server if needed
	const port = await docServer.ensureStarted();

	// Store document
	const id = randomUUID();
	const entry: DocEntry = {
		id,
		title,
		format: effectiveFormat,
		content: htmlContent,
		createdAt: Date.now(),
	};
	docServer.addDoc(entry);

	// Build URL and open browser
	const url = `http://127.0.0.1:${port}/doc/${id}`;
	await openBrowser(url);

	return { id, url, title };
}

// ---------------------------------------------------------------------------
// Browser opener
// ---------------------------------------------------------------------------

async function openBrowser(url: string): Promise<void> {
	const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
	await execAsync(cmd);
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function showInBrowserExtension(pi: ExtensionAPI) {
	// Cleanup on session shutdown
	pi.on("session_shutdown", async () => {
		docServer.shutdown();
	});

	// Intercept show_in_browser tool calls with format: "markdown" and convert
	// to light-themed HTML before execution. This ensures the markdown always
	// renders in light mode regardless of whether the built-in tool or the
	// extension's tool handles the call.
	pi.on("tool_call", async (event, _ctx) => {
		if (event.toolName !== "show_in_browser") return;
		if (event.input.format !== "markdown") return;

		try {
			let mdContent: string;
			if (event.input.filePath) {
				mdContent = await readFile(resolve(event.input.filePath), "utf-8");
				delete event.input.filePath;
			} else if (event.input.content) {
				mdContent = event.input.content;
			} else {
				return; // nothing to convert
			}

			const title = event.input.title || autoTitle("markdown");
			const htmlContent = buildMarkdownHtml(mdContent, title);

			event.input.format = "html";
			event.input.content = htmlContent;
		} catch (err) {
			console.error("[show-in-browser] Markdown interceptor error:", err);
		}
	});

	// Inject markdown writing guidelines into system prompt so LLM generates
	// well-structured markdown that renders correctly in the browser viewer
	pi.on("before_agent_start", async (event) => {
		const mdGuidelines = [
			"",
			"## Markdown Writing Rules (show_in_browser)",
			"",
			"When generating markdown that may be displayed via show_in_browser, follow these structural rules or the content will render as broken/misformatted HTML:",
			"",
			"1. **Blank lines separate elements** — headings, paragraphs, lists, code blocks, and tables must each be preceded and followed by a blank line.",
			"2. **Headings stand alone** — a heading line contains ONLY the heading text (e.g. `### Title`). Never append list items, descriptions, or body text on the same heading line. Write the heading, then a blank line, then the content below.",
			"3. **List items on separate lines** — each `- item` or `1. item` must be its own line. Never put multiple list items on one line separated by dashes.",
			"4. **Lines ending with colons introduce lists** — after any line ending in `:`, add a blank line then a `- ` bulleted list.",
			"5. **Code blocks are fenced** — use triple backticks on their own line to open/close code blocks, with a blank line before and after.",
			"",
			"Example of correct formatting:",
			"```markdown",
			"### Section Title",
			"",
			"- **Label**: value",
			"- **Label**: value",
			"",
			"### Decisions",
			"",
			"1. **Choice A** — rationale",
			"2. **Choice B** — rationale",
			"```",
			"",
			"Example of BAD formatting (never do this):",
			"```markdown",
			"### Title - **Label**: value - **Label**: value",
			"### Decisions 1. **Choice A** — rationale 2. **Choice B** — rationale",
			"```",
		].join("\n");

		return {
			systemPrompt: event.systemPrompt + mdGuidelines,
		};
	});

	// Register the LLM tool
	pi.registerTool({
		name: "show_in_browser",
		label: "Show in Browser",
		description:
			"Render and display a document in the user's browser. Supports HTML (served as-is), JSON (interactive collapsible tree), and Markdown (styled HTML with syntax highlighting). The document opens in a new browser tab automatically.",
		promptSnippet: "Display HTML, JSON, or Markdown content in the user's browser for review",
		promptGuidelines: [
			"Use show_in_browser when you need to share a document, spec, or data with the user for visual review, feedback, or approval.",
			"ALWAYS explain to the user WHY you are showing the document and what you need from them (feedback, approval, corrections, next steps).",
			"When showing specs or plans, mention the key sections the user should focus on.",
			"When format is 'markdown', write structurally correct GFM: blank lines between all elements (headings, paragraphs, lists, code blocks, tables), headings must stand alone on their own line (never append list items to a heading line), each list item on its own line with proper `- ` or `1. ` prefix, lines ending with `:` must be followed by a blank line and a bulleted list, code blocks fenced with triple backticks on their own line.",
		],
		parameters: Type.Object({
			format: StringEnum(["html", "json", "markdown"] as const, {
				description:
					"Content format. 'html' is served as-is. 'json' renders as an interactive collapsible tree. 'markdown' renders as styled HTML with syntax highlighting.",
			}),
			content: Type.Optional(
				Type.String({
					description: "Raw content to display. For markdown format: use standard GFM structure — blank lines between headings/paragraphs/lists/code blocks, headings on their own line (no inline list items), each list item on a separate line, code blocks triple-fenced. Use this OR filePath, not both.",
				}),
			),
			filePath: Type.Optional(
				Type.String({
					description: "Path to a file to read and display. Use this OR content, not both.",
				}),
			),
		}),
		prepareArguments(args) {
			// Auto-detect format from filePath if not specified
			if (!args.format && args.filePath) {
				(args as Record<string, unknown>).format = detectFormat(String(args.filePath));
			}
			// Default to html if nothing specified
			if (!args.format) {
				(args as Record<string, unknown>).format = "html";
			}
			return args;
		},
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			if (!params.content && !params.filePath) {
				return {
					content: [
						{
							type: "text",
							text: "Error: provide either 'content' (inline text) or 'filePath' (path to file).",
						},
					],
					isError: true,
				};
			}

			try {
				const result = await showInBrowser({
					format: params.format,
					content: params.content,
					filePath: params.filePath,
				});

				return {
					content: [
						{
							type: "text",
							text: `Document opened in browser: "${result.title}"\nURL: ${result.url}`,
						},
					],
					details: { id: result.id, url: result.url, title: result.title },
				};
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Error opening document: ${message}` }],
					isError: true,
				};
			}
		},
	});

	// Register /show-doc command
	pi.registerCommand("show-doc", {
		description:
			"Open a document in the browser. Usage: /show-doc <file-path>  or  /show-doc --format json --content '{...}'",
		getArgumentCompletions(prefix: string) {
			// Simple file path completion - return null to use default
			return null;
		},
		handler: async (args, ctx) => {
			if (!args?.trim()) {
				ctx.ui.notify("Usage: /show-doc <file-path>", "warning");
				return;
			}

			// Parse simple flags
			let format: "html" | "json" | "markdown" | undefined;
			let filePath: string | undefined;
			let content: string | undefined;

			const parts = args.trim().split(/\s+/);
			for (let i = 0; i < parts.length; i++) {
				if (parts[i] === "--format" && parts[i + 1]) {
					format = parts[++i] as "html" | "json" | "markdown";
				} else if (parts[i] === "--content" && parts[i + 1]) {
					// Consume rest of args as content
					content = parts.slice(i + 1).join(" ");
					break;
				} else if (!parts[i].startsWith("--")) {
					filePath = parts[i];
				}
			}

			try {
				const result = await showInBrowser({ format, content, filePath });
				ctx.ui.notify(`Opened: ${result.title}`, "info");
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`Error: ${message}`, "error");
			}
		},
	});

	// Register /docs command to list and re-open documents
	pi.registerCommand("docs", {
		description: "List documents opened this session and re-open one in the browser",
		handler: async (_args, ctx) => {
			const docs = docServer.getDocs();

			if (docs.length === 0) {
				ctx.ui.notify("No documents opened this session.", "info");
				return;
			}

			if (!ctx.hasUI) {
				// Non-interactive fallback: just list
				for (const doc of docs) {
					ctx.ui.notify(`[${doc.format}] ${doc.title}`, "info");
				}
				return;
			}

			const items = docs.map((doc) => ({
				value: doc.id,
				label: `[${doc.format}] ${doc.title}`,
				description: new Date(doc.createdAt).toLocaleTimeString(),
			}));

			const selected = await ctx.ui.select("Re-open a document:", items.map((i) => i.label));
			if (selected) {
				const idx = items.findIndex((i) => i.label === selected);
				if (idx >= 0) {
					const doc = docs[idx];
					const port = await docServer.ensureStarted();
					const url = `http://127.0.0.1:${port}/doc/${doc.id}`;
					await openBrowser(url);
					ctx.ui.notify(`Re-opened: ${doc.title}`, "info");
				}
			}
		},
	});
}
