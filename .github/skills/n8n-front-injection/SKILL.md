---
name: n8n-front-injection
description: "Manage the dual-delivery pattern for the agent front-end: a single source-of-truth HTML monolith (front-<brand>.html) that is automatically split into Netlify static artifacts (index.html + polyfills.js + auth-storage.js + app.js) AND injected into an n8n-served HTML node (Sameka-Front.json equivalent). USE WHEN cloning the front for a new agent, fixing 'my Netlify split is out of sync', adding inline scripts, debugging iframe storage issues, or wiring up auth-storage.js with localStorage→cookie→memory fallback. Covers the two PowerShell sync scripts, the inline-script split boundaries, the navigator.locks polyfill order, and how to keep netlify.toml minification OFF."
argument-hint: "Provide: brand_prefix, brand_display, auth_mode (mock/shared-token/supabase), whether n8n-served front is needed"
---

# n8n Front Injection & Netlify Split

How the front-end is built, split, and synchronized in this agent pattern. One source file, two deploy targets, never edited by hand on the target side.

## When to Use

- "Set up the front for a new agent"
- "My Netlify version doesn't match the monolith"
- "How do I add a new inline script?"
- "Session is lost on reload (iframe / sandbox)"
- "Where does the navigator.locks polyfill go?"
- "I need to serve the front from n8n too"

## Do NOT Use For

- Designing chat UI features (UI logic lives inside the monolith)
- Auth strategy (use `supabase-auth` or `n8n-credential-placeholders` for tokens)

## The Pattern: One Source, Two Targets

```
                front-<brand>.html  ← source of truth (you edit ONLY this)
                       │
        ┌──────────────┴──────────────┐
        │                             │
[_sync-netlify.ps1]            [_sync-front-workflow.ps1]
        │                             │
        ▼                             ▼
netlify/                       workspaces/<Brand>-Front.json
  ├ index.html                   (HTML inlined into the
  ├ polyfills.js                  webhook response node)
  ├ auth-storage.js
  └ app.js
```

**Never** edit `netlify/*` or `<Brand>-Front.json` by hand. Edit only `front-<brand>.html` and re-run the sync scripts.

## Inline `<script>` Order (critical)

Inside `front-<brand>.html`, the order matters because some scripts polyfill globals that later scripts depend on.

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title><Brand Display></title>
  <!-- styles -->
</head>
<body>
  <!-- markup -->

  <!-- 1. polyfills: MUST come first; defines navigator.locks shim, storage shims -->
  <script id="polyfills">/* ... */</script>

  <!-- 2. auth-storage: defines the iframe-safe storage adapter used by createClient -->
  <script id="auth-storage">/* ... */</script>

  <!-- 3. supabase / vendor libs (CDN) — only if auth_mode=supabase -->
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

  <!-- 4. app: main app code, depends on everything above -->
  <script id="app">/* ... */</script>
</body>
</html>
```

The split script (`_sync-netlify.ps1`) uses the `<script id="...">` attribute to know **which inline block goes to which file**:
- `id="polyfills"` → `netlify/polyfills.js`
- `id="auth-storage"` → `netlify/auth-storage.js`
- `id="app"` → `netlify/app.js`

External `<script src="…">` tags are kept as-is in `netlify/index.html`.

## `polyfills.js` (always include)

Mandatory shims for sandboxed iframes and weird storage environments:

```js
// 1. navigator.locks shim — Supabase JS v2 uses this; missing it = NavigatorLockAcquireTimeoutError
if (!('locks' in navigator)) {
  const queues = new Map();
  navigator.locks = {
    request: async (name, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      const q = queues.get(name) || Promise.resolve();
      let release;
      const next = new Promise(r => release = r);
      queues.set(name, q.then(() => next));
      await q;
      try { return await cb({ name }); } finally { release(); }
    }
  };
}

// 2. storage detect (used by auth-storage.js to choose strategy)
window.__storageAvailable = (() => {
  try { localStorage.setItem('__t__','1'); localStorage.removeItem('__t__'); return true; }
  catch { return false; }
})();
```

## `auth-storage.js` (always include)

Iframe-safe storage adapter with a 3-tier fallback chain. Used by `createClient` and by mock auth.

```js
const PREFIX = '<brand_prefix>_';
const memStore = {};
const cookieGet = (k) => document.cookie.split('; ').find(c=>c.startsWith(k+'='))?.split('=')[1];
const cookieSet = (k,v) => document.cookie = `${k}=${v}; path=/; SameSite=Lax; max-age=${60*60*24*7}`;

window.<BRAND_UPPER>_STORAGE = {
  getItem: (k) => {
    if (window.__storageAvailable) return localStorage.getItem(PREFIX+k);
    const cv = cookieGet(PREFIX+k);
    if (cv) return decodeURIComponent(cv);
    return memStore[PREFIX+k] ?? null;
  },
  setItem: (k, v) => {
    if (window.__storageAvailable) { localStorage.setItem(PREFIX+k, v); return; }
    // cookie chunking for tokens >4KB
    try { cookieSet(PREFIX+k, encodeURIComponent(v)); }
    catch { memStore[PREFIX+k] = v; }
  },
  removeItem: (k) => {
    if (window.__storageAvailable) { localStorage.removeItem(PREFIX+k); return; }
    cookieSet(PREFIX+k, ''); delete memStore[PREFIX+k];
  }
};
```

In `app.js`, pass it to Supabase:

```js
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: window.<BRAND_UPPER>_STORAGE,
    storageKey: '<brand_prefix>_session'
  }
});
```

## `app.js` (the main thing)

Conventional structure:

```js
// === constants ===
const API_BASE = '__FILL_ME__API_BASE__';
const BRAND_PREFIX = '<brand_prefix>';

// === auth (one of three) ===
// mock: const MOCK_USERS = [...]; helpers for sessionStorage
// shared-token: const AGENT_SHARED_TOKEN = '...';
// supabase: createClient(...) using window.<BRAND_UPPER>_STORAGE

// === API calls ===
async function postChat({ session_id, message }) {
  const user = getCurrentUser();
  const userContextBlock = `<user_context>\nnome: ${user.name}\nrole: ${user.role}\n...\nsession_id: ${session_id}\nts: ${new Date().toISOString()}\n</user_context>\n\n<user_message>\n${message}\n</user_message>`;
  return fetch(`${API_BASE}/<webhook_namespace>-AgentRag`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authHeader()) },
    body: JSON.stringify({ session_id, message: userContextBlock })
  }).then(r => r.json());
}

// === UI rendering (sidebar, chat, special blocks) ===
// Custom fenced-block renderers for <brand>-leads, <brand>-product-images, etc.
```

## Netlify TOML (do not change these flags)

```toml
[build]
  publish = "netlify"

[build.processing]
  skip_processing = true

[build.processing.html]
  pretty_urls = false

[build.processing.css]
  bundle = false
  minify = false

[build.processing.js]
  bundle = false
  minify = false

[build.processing.images]
  compress = false
```

**Why**: minification breaks the inline-script→file split contract and corrupts the polyfill order. Keep everything verbatim.

Also add `netlify-no-optimize` marker comments at the top of `netlify/index.html` so the Netlify build system doesn't try to re-optimize on commit:

```html
<!DOCTYPE html>
<!-- netlify-no-optimize -->
<html lang="pt-BR">
```

## `_sync-netlify.ps1` (template)

```pwsh
$ErrorActionPreference = 'Stop'
$src = Get-Content "front-<brand>.html" -Raw

# 1. Extract inline scripts by id
function Extract-Script([string]$id, [ref]$rest) {
    $pattern = "<script\s+id=`"$id`"[^>]*>([\s\S]*?)</script>"
    $m = [regex]::Match($rest.Value, $pattern)
    if (-not $m.Success) { throw "missing <script id=$id> in source" }
    $rest.Value = $rest.Value.Remove($m.Index, $m.Length)
    return $m.Groups[1].Value
}

$rest = $src
$polyfills    = Extract-Script "polyfills"    ([ref]$rest)
$authStorage  = Extract-Script "auth-storage" ([ref]$rest)
$app          = Extract-Script "app"          ([ref]$rest)

# 2. Write JS files
New-Item -ItemType Directory -Force -Path "netlify" | Out-Null
Set-Content "netlify/polyfills.js"    $polyfills
Set-Content "netlify/auth-storage.js" $authStorage
Set-Content "netlify/app.js"          $app

# 3. Rewrite index.html with external <script src> references in original order
$html = $rest `
  -replace '<script\s+id="polyfills"[^>]*></script>',    '<script src="./polyfills.js"></script>' `
  -replace '<script\s+id="auth-storage"[^>]*></script>', '<script src="./auth-storage.js"></script>' `
  -replace '<script\s+id="app"[^>]*></script>',          '<script src="./app.js"></script>'

# Insert the netlify-no-optimize marker right after <!DOCTYPE html>
$html = $html -replace '(<!DOCTYPE html>\s*)', "`$1<!-- netlify-no-optimize -->`n"

Set-Content "netlify/index.html" $html
Write-Host "✓ netlify split written"
```

## `_sync-front-workflow.ps1` (template — only if n8n-served front is needed)

```pwsh
$ErrorActionPreference = 'Stop'
$html  = Get-Content "front-<brand>.html" -Raw
$wfPath = "workspaces/<Brand>-Front.json"
$wf    = Get-Content $wfPath -Raw | ConvertFrom-Json -Depth 100

# Find the HTML response node (by node type or name)
$node = $wf.nodes | Where-Object { $_.name -eq 'Respond HTML' }
if (-not $node) { throw "node 'Respond HTML' not found in $wfPath" }

# Inject the full HTML as the response body
$node.parameters.responseBody = $html

$wf | ConvertTo-Json -Depth 100 | Set-Content $wfPath
Write-Host "✓ HTML injected into $wfPath"
```

Both scripts are **idempotent**: running them twice produces no diff if the source didn't change.

## Common Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| `NavigatorLockAcquireTimeoutError` after page reload | navigator.locks polyfill missing or loaded after Supabase | move polyfills.js to the very top, before any vendor script |
| Session lost after refresh in iframe | localStorage blocked; cookie/memory tier missing | use the full 3-tier storage adapter |
| Netlify deploy works locally but breaks in prod | post-processing/minification ate the inline split | confirm `netlify.toml` flags + `netlify-no-optimize` marker |
| `<Brand>-Front.json` import fails in n8n | HTML too large for single node body | switch to Netlify-only (drop the n8n-served front) |
| New script edits lost | someone edited `netlify/app.js` directly | always edit `front-<brand>.html`, then re-run sync |
| `front-<brand>.html` has multiple `<script id="app">` blocks | extraction regex matches only the first | enforce one block per id; lint with `grep -c 'id="app"'` |

## Quality Bar

- [ ] Only `front-<brand>.html` is edited by humans.
- [ ] Exactly three inline `<script id="...">` blocks: `polyfills`, `auth-storage`, `app`.
- [ ] `polyfills` block precedes any vendor `<script src>`.
- [ ] `auth-storage` declares `window.<BRAND_UPPER>_STORAGE` (no global var leakage besides this).
- [ ] `netlify.toml` keeps all minification/bundling flags OFF.
- [ ] `netlify-no-optimize` marker present in generated `index.html`.
- [ ] `_sync-netlify.ps1` runs cleanly and produces exactly 4 files in `netlify/`.
- [ ] `_sync-front-workflow.ps1` (if used) leaves the JSON parseable.
- [ ] No service-role key or Postgres password in any `netlify/*` file.
- [ ] All scripts re-runnable with no diff on the second run if source is unchanged.

## Anti-patterns

- Editing `netlify/app.js` directly → next sync overwrites your changes.
- Loading Supabase before the polyfills → lock errors in sandbox.
- Inlining the service-role key for "convenience" → instant DB takeover.
- Using `defer`/`async` on the polyfills script → race condition with Supabase init.
- Combining multiple concerns into one inline `<script>` block (no `id`) → split script can't extract.
- Letting Netlify minification run "just for performance" → invisible breakage of the polyfill ordering.
