---
name: n8n-workflow-rewrite
description: "Mechanically clone an n8n workflow JSON for a different brand/tenant: substitute identifiers (table names, webhook paths, workflow IDs, credential names, system prompts) while preserving internal node IDs, connections, version metadata, and credential reference shape. USE WHEN cloning Sameka-* workflows for a new agent, renaming a workflow's brand, fixing leftover 'sameka' tokens in a JSON, or batch-rewriting multiple workflows consistently. Covers safe-vs-unsafe fields, case-aware substitution, post-import credential rebinding, and verification."
argument-hint: "Provide: source workflow path, target path, brand_prefix, Brand_Display, [Brand_Tag], webhook_namespace"
---

# n8n Workflow Rewrite

Recipe to clone an n8n workflow JSON from one brand/tenant to another without breaking it. Optimized for the Sameka → `<Brand>` clone pattern but generic.

## When to Use

- "Clone Sameka-Agent-IA-copy.json for brand X"
- "Rename all `sameka` references in `Sameka-RAG.json`"
- "Fix the leftover [Sameka] in my subflow"
- "Batch-rewrite all 12 workflows for the new tenant"

## Do NOT Use For

- Designing a new workflow from scratch
- Editing live workflows via the n8n UI (this is JSON-level)

## Parameters

| Param | Example |
|---|---|
| `OLD_PREFIX` | `sameka` |
| `NEW_PREFIX` | `acme` |
| `OLD_DISPLAY` | `Sameka` |
| `NEW_DISPLAY` | `Acme` |
| `OLD_TAG` | `[Sameka]` |
| `NEW_TAG` | `[Acme]` |
| `OLD_NS` | `sameka` (in `/sameka-*` paths) |
| `NEW_NS` | `acme` |
| `OLD_TENANT` | `sameka` (in `company_name='sameka'`) |
| `NEW_TENANT` | `acme` |

## Safe-to-Rewrite Fields (semantic, brand-coupled)

These MUST be substituted. Walk the JSON tree and rewrite:

| JSON path | What |
|---|---|
| `name` (root) | Workflow name |
| `nodes[].name` | Node display names mentioning the brand |
| `nodes[].parameters.path` (Webhook nodes) | `/<NS>-*` paths |
| `nodes[].parameters.options.respondPath` | webhook response path |
| `nodes[].parameters.tableName` (Postgres, Supabase Vector Store, memoryPostgresChat) | `<prefix>_*` |
| `nodes[].parameters.schema` (Postgres) | if using a brand schema |
| `nodes[].parameters.query` / `queryName` (Supabase) | match function `match_<prefix>_documents` |
| `nodes[].parameters.sessionTableName` / `tableName` (memory nodes) | chat memory table |
| `nodes[].parameters.systemMessage` (LangChain Agent) | system prompt body |
| `nodes[].parameters.text` / `value` / `jsCode` (Code, Set nodes) | strings, regex literals, comments referencing brand |
| `nodes[].parameters.url` (HTTP Request) | if it contains brand domain |
| `nodes[].parameters.options.headers.header[].name|value` | `X-<Brand>-Token` etc. |
| `nodes[].credentials.<credType>.name` | credential display name (rebind after import) |
| `nodes[].parameters.workflowId.value` and `.cachedResultName` (Execute Workflow) | renamed subflow refs |
| `tags[].name` | brand tag |
| `meta.description` | if present |

## DO-NOT-TOUCH Fields (structural)

Changing these breaks the workflow:

- `nodes[].id` (UUID)
- `nodes[].type`, `nodes[].typeVersion`
- `nodes[].position`
- `connections` keys (they map by node **name**, but you ARE renaming names — see note below)
- `versionId`, `id` (root), `meta.instanceId`
- `pinData` keys (also map by node name)
- `credentials.<credType>.id` (credential UUID; only `.name` changes for display, the `.id` rebinds to your new credential)

### Critical detail: `connections` map by node name

The `connections` object uses **node name** as the key. If you rename `nodes[].name`, you MUST also rewrite every occurrence of that exact string in:
- `connections` top-level keys
- `connections.<src>.<output>[][].node` (the target name)
- `pinData` keys

**Strategy**: collect the full list of `nodes[].name` rewrites first, build a map `oldName → newName`, then apply that map to `connections` and `pinData` in one pass.

## Substitution Order (matters)

Apply replacements **longest-token first** to avoid clobbering compound names.

1. `[Sameka] Sub-fluxo_ Drive Document Manager` → `[Acme] Sub-fluxo_ Drive Document Manager` (specific subflow names)
2. `[Sameka]` → `[Acme]`
3. `Sameka-Agent-IA-copy` → `Acme-Agent-IA` (workflow filenames in `cachedResultName`)
4. `Sameka-` → `Acme-` (workflow name prefixes)
5. `match_sameka_documents` → `match_acme_documents`
6. `sameka_admin_*` (regex) → `acme_admin_*`
7. `sameka_chat_message`, `sameka_chat_session`, `sameka_documents`, `sameka_document_metadata`, `sameka_document_rows`, `sameka_schema_migrations`, `sameka_is_admin` → `acme_*`
8. `sameka_` (catch-all) → `acme_`
9. `company_name = 'sameka'` (and `"sameka"`) → `'acme'`
10. `/sameka-` → `/acme-` (webhook paths)
11. `SAMEKA` → `ACME`
12. `Sameka` → `Acme` (display)
13. `sameka` → `acme` (last; lowercase fallback)

Always case-aware. Never replace inside Drive/Sheets IDs, UUIDs, or base64 blobs.

## Procedure

```pwsh
# 1. Copy source → target with new filename
Copy-Item "workspaces/Sameka-Agent-IA-copy.json" "out/Acme-Agent-IA.json"

# 2. Load JSON
$j = Get-Content "out/Acme-Agent-IA.json" -Raw | ConvertFrom-Json -Depth 100

# 3. Walk + rewrite (use a recursive function that touches ONLY the safe-to-rewrite fields)
#    Build oldName→newName map from nodes[].name changes first.

# 4. Apply name map to connections and pinData

# 5. Stringify and write
$j | ConvertTo-Json -Depth 100 | Set-Content "out/Acme-Agent-IA.json"

# 6. Verify
grep -i "sameka" out/Acme-Agent-IA.json   # must be empty (except in docs/refs)
grep "Sameka" out/Acme-Agent-IA.json      # must be empty
```

For text-level fields (`systemMessage`, `jsCode`), use string `.Replace` per the substitution order. For everything else, prefer targeted property writes.

## Post-Import in n8n

After importing the rewritten JSON:

1. **Rebind credentials**. The `credentials.<credType>.id` UUIDs point at credentials in the **source** n8n instance. In the target instance, edit each node and select the new credential (named e.g. `Postgres Acme`).
2. **Activate webhooks**. Confirm each Webhook node's `path` is unique within the target n8n instance.
3. **Verify Execute Workflow refs**. Each `Execute Workflow` node has `workflowId.value` = the UUID of the target subflow. After importing subflows, edit those nodes and select the newly-imported subflow.
4. **Run one smoke call** per webhook to ensure the rewrite didn't break parsing.

## Verification Checklist

- [ ] `grep -i "sameka"` on the rewritten JSON returns zero hits (except intentional doc references).
- [ ] `nodes.length` matches the source.
- [ ] `Object.keys(connections).length` matches the source.
- [ ] All `nodes[].id` UUIDs unchanged.
- [ ] All `connections.<key>.<output>[][].node` values reference existing renamed node names.
- [ ] No accidental rewrites inside Drive `file_id`, Sheets ID, UUIDs, JWTs, base64 payloads.
- [ ] Workflow imports into n8n without errors.

## Anti-patterns

- "Do a global `sed s/sameka/acme/g`" → corrupts UUIDs and base64. Use token-aware replacement.
- "Rename nodes but forget connections" → workflow becomes a graph of orphans.
- "Replace `Sameka` everywhere including inside `cachedResultName` UUIDs" → breaks references.
- "Skip credential rebinding because the JSON still has the credential.id" → credentials are scoped per n8n instance; the UUID won't match the target.
- "Keep the same webhook path on both instances" → collision if you run them in parallel.

## Reference Implementation

See the Sameka workspace for source examples: [workspaces/Sameka-Agent-IA-copy.json](../../../workspaces/Sameka-Agent-IA-copy.json), [workspaces/Sameka-RAG.json](../../../workspaces/Sameka-RAG.json), [workspaces/[Sameka] Sub-fluxo_ Drive Document Manager.json](../../../workspaces/%5BSameka%5D%20Sub-fluxo_%20Drive%20Document%20Manager.json).
