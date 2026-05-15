---
name: n8n-rag-stable-id
description: "Build a RAG ingest/admin pipeline in n8n where every source document keeps a STABLE identity (Drive file_id or local filename) across content updates. USE WHEN the user asks to add RAG, replace a document in Drive without losing links, reindex changed files only, set up a dedicated Drive folder for the knowledge base, design the vector store schema (Tier B), or fix 'every reset deletes my docs'. Covers Drive folder isolation, files.update vs files.delete, sha256 manifest for in-repo docs, transactional vector row replacement, scheduled watchers, archived flag."
argument-hint: "Provide: brand_prefix, webhook_namespace, RAG location (drive | local | both), DRIVE_FOLDER_ID_RAG if Drive"
---

# n8n RAG with Stable File Identity

Playbook to ship a RAG pipeline where **one logical document = one stable ID forever**. Replacing content never breaks chat history references, never orphans vector rows, never forces a full re-ingest.

## When to Use

- "Add RAG to my agent"
- "I need to update the PDF without losing the link"
- "Reindex only what changed"
- "Set up the vector store"
- "My RAG resets every time I redeploy"
- "How do I organize Drive folders for the agent"

## Do NOT Use For

- Choosing the embedding model (provider-specific)
- LLM provider auth (use the n8n credential)
- Writing the Supabase Auth layer (use `supabase-auth` skill)

## Core Invariant

> **One logical document = one stable ID forever.** Replace bytes, never delete + recreate.

Why: vector rows, chat history, and external links carry the document ID. Deleting the file or renaming the path orphans references and forces re-ingest.

## Parameters

| Param | Example | Notes |
|---|---|---|
| `PREFIX` | `acme_` | SQL identifier prefix |
| `NS` | `acme` | webhook namespace |
| `DRIVE_FOLDER_ID_RAG` | `1AbCdEf…` | **Dedicated** folder ID, ONLY RAG docs |
| `DRIVE_FILE_ID_<NAME>` | `1XyZ…` | one per logical doc |
| `LOCAL_RAG_DIR` | `RAG/` | when local docs exist |
| `EMBED_DIM` | `1536` | match your embedder |

## Two Storage Modes

| Mode | When | Identity |
|---|---|---|
| **Drive (default)** | Editable, client-owned docs | Stable `file_id` inside `DRIVE_FOLDER_ID_RAG` |
| **Local in-repo** | Static seed docs, prompts, schemas | Filename inside `RAG/` |

**Pick one per logical doc, never both.**

### Drive folder isolation (NON-NEGOTIABLE)

- `DRIVE_FOLDER_ID_RAG` is a **dedicated** folder. Nothing else lives there.
- Other Drive uses (uploads, sheets, exports) get separate folder IDs (`DRIVE_FOLDER_ID_UPLOADS`, etc.).
- The RAG watcher MUST list with `q='<DRIVE_FOLDER_ID_RAG>' in parents and trashed=false` — never the root, never global.
- The Replace subflow MUST validate that the target `file_id` has `DRIVE_FOLDER_ID_RAG` in its `parents` (via `files.get?fields=parents`). Refuse on mismatch.
- Share the folder with the n8n service account; other folders have their own permissions.

## Tier B Schema (created by `<Brand>-DB-Schema-Setup.json`, NOT migrations)

Idempotent setup; safe to re-run; never references Tier A (`auth.users`, chat tables).

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS <PREFIX>document_metadata (
  file_id      text PRIMARY KEY,           -- Drive file_id OR 'local:<filename>'
  title        text NOT NULL,
  mime         text,
  source       text NOT NULL,              -- 'drive' | 'local'
  parents      text[],                     -- Drive parents for audit
  sha256       text,                       -- local files
  modified_time timestamptz,               -- Drive
  archived     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS <PREFIX>document_rows (
  id           bigserial PRIMARY KEY,
  file_id      text NOT NULL REFERENCES <PREFIX>document_metadata(file_id) ON DELETE CASCADE,
  row_index    int  NOT NULL,
  data         jsonb NOT NULL              -- XLSX rows or structured extracts
);
CREATE INDEX IF NOT EXISTS <PREFIX>document_rows_file_idx ON <PREFIX>document_rows(file_id);

CREATE TABLE IF NOT EXISTS <PREFIX>documents (
  id           bigserial PRIMARY KEY,
  file_id      text NOT NULL REFERENCES <PREFIX>document_metadata(file_id) ON DELETE CASCADE,
  chunk_index  int  NOT NULL,
  content      text NOT NULL,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding    vector(<EMBED_DIM>)
);
CREATE INDEX IF NOT EXISTS <PREFIX>documents_file_idx ON <PREFIX>documents(file_id);
CREATE INDEX IF NOT EXISTS <PREFIX>documents_embed_idx ON <PREFIX>documents
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE OR REPLACE FUNCTION match_<PREFIX>documents(
  query_embedding vector(<EMBED_DIM>),
  match_count int DEFAULT 5,
  filter jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(id bigint, file_id text, content text, metadata jsonb, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT d.id, d.file_id, d.content, d.metadata,
         1 - (d.embedding <=> query_embedding) AS similarity
  FROM <PREFIX>documents d
  JOIN <PREFIX>document_metadata m ON m.file_id = d.file_id
  WHERE m.archived = false
    AND d.metadata @> filter
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
$$;

NOTIFY pgrst, 'reload schema';
```

**Note**: the `ON DELETE CASCADE` here is OK — it cascades **within Tier B only** (rows/chunks under a metadata row). Tier A (auth.users, chat) is never touched.

## n8n Workflows

Three workflows total for RAG:

### 1. `<Brand>-DB-Schema-Setup.json` (Tier B only)

- One webhook `POST /<NS>-rag-schema-setup`.
- Runs the SQL above. Pure idempotent. Safe to run on every deploy.
- Refuses if connected to wrong DB (guard node checks DB name).

### 2. `<Brand>-RAG.json` (main RAG pipeline)

Endpoints:
| Path | Purpose |
|---|---|
| `POST /<NS>-rag-reindex-drive` | Manual full sweep of `DRIVE_FOLDER_ID_RAG` |
| `POST /<NS>-rag-reindex-local` | Walk `RAG/manifest.json`, embed changed |
| `POST /<NS>-rag-drive-replace` | Replace bytes of an existing `file_id` |
| `POST /<NS>-rag-doc-archive` | Mark `archived=true` |
| `GET  /<NS>-rag-docs` | List metadata |
| `POST /<NS>-rag-purge-all` | `TRUNCATE` Tier B rows only (no DROP) |

Scheduled trigger every N minutes calls reindex-drive.

### 3. `[<Brand>] Sub-fluxo_ Drive Content Replace` (called by `/<NS>-rag-drive-replace`)

Pseudocode:
```
1. input: { file_id, new_content (base64|url), mime, idempotency_key }
2. files.get(file_id, fields=parents,name,modifiedTime)
3. assert DRIVE_FOLDER_ID_RAG IN parents  → else return { ok:false, error:'file outside RAG folder' }
4. files.update(file_id, media=new_content)  // SAME id, bytes replaced
5. BEGIN TRANSACTION
     DELETE FROM <PREFIX>documents WHERE file_id = $1;
     DELETE FROM <PREFIX>document_rows WHERE file_id = $1;
     UPSERT <PREFIX>document_metadata (file_id, modified_time, updated_at)
     -- extract + chunk + embed new_content
     INSERT INTO <PREFIX>documents (file_id, chunk_index, content, embedding, metadata) ...
   COMMIT
6. return { ok:true, data:{ file_id, chunks_inserted } }
```

**Never** call `files.delete`. Never move the file between folders.

## Watcher Logic

### Drive (scheduled)

```
files.list(q="'<DRIVE_FOLDER_ID_RAG>' in parents and trashed=false",
           fields="files(id,name,mimeType,modifiedTime,parents)")
for each f:
  prev = SELECT modified_time FROM <PREFIX>document_metadata WHERE file_id=f.id
  if prev IS NULL: ingest as new (no DELETE needed)
  else if f.modifiedTime > prev: trigger drive-replace subflow with content fetched from Drive
```

### Local (manual reindex)

```
read RAG/manifest.json
for each {filename, sha256}:
  prev = SELECT sha256 FROM <PREFIX>document_metadata WHERE file_id='local:'||filename
  if prev != sha256: re-embed (DELETE rows/chunks for that file_id, INSERT new)
```

## Adding a New Document (operator procedure)

### Drive
1. Manually upload the file ONCE to `DRIVE_FOLDER_ID_RAG`.
2. Copy the `file_id` from the URL.
3. Register as `DRIVE_FILE_ID_<NAME>` in n8n credentials/env.
4. Trigger `POST /<NS>-rag-reindex-drive` (or wait for watcher).
5. From now on, updates go through `POST /<NS>-rag-drive-replace`.

### Local
1. Drop the file into `RAG/`.
2. Run `pwsh ./scripts/update-rag-manifest.ps1` (computes sha256, updates manifest.json).
3. Commit.
4. Trigger `POST /<NS>-rag-reindex-local`.

## `RAG/manifest.json` Shape

```json
{
  "version": 1,
  "files": {
    "catalogo-meow.pdf": {
      "title": "Catálogo Meow 2026",
      "mime": "application/pdf",
      "sha256": "ab12…",
      "version": 3,
      "last_updated": "2026-04-12T10:00:00Z"
    }
  }
}
```

## Front Behavior

RAG admin panel:
- Lists each doc with `file_id` (Drive) or `filename` (local), `title`, `archived`, `updated_at`.
- "Replace content" uploads → calls `/<NS>-rag-drive-replace` (Drive) or shows git instructions (local).
- "Archive" → sets `archived=true`. Hidden destructive confirm.
- Shows `DRIVE_FOLDER_ID_RAG` at the top so the admin verifies the right folder.
- **No "Delete file" button.** Real deletion only by an operator outside the agent.

## Quality Bar

- [ ] `DRIVE_FOLDER_ID_RAG` defined, dedicated, isolated from other Drive uses.
- [ ] Every `files.update` call validates `parents` first.
- [ ] Watcher lists with `'<DRIVE_FOLDER_ID_RAG>' in parents` (never root, never global).
- [ ] No `files.delete` anywhere in the workflows.
- [ ] Replace subflow runs `DELETE WHERE file_id=$1; INSERT ...` in a single transaction.
- [ ] All Tier B DDL is `IF NOT EXISTS` / `CREATE OR REPLACE`.
- [ ] No reference to Tier A tables anywhere in the RAG workflows.
- [ ] `<PREFIX>document_metadata.archived` filters retrieval in `match_<PREFIX>documents`.
- [ ] `RAG/manifest.json` exists if local mode is used; sha256 powers skip-unchanged.
- [ ] Front shows the stable ID per doc; no "Delete + re-upload" affordance.

## Anti-patterns

- "Delete the file and upload a new version" → never. Use Replace on the same `file_id`.
- "Rename to `catalogo-v2.pdf`" → never. Overwrite same name; bump `version` in manifest.
- "List the whole Drive root in the watcher" → costs money and ingests garbage.
- "Mix RAG docs with uploads in the same folder" → impossible to scope watchers safely.
- "Drop and recreate the vector tables on every deploy" → re-embedding is expensive; use TRUNCATE + reindex if you really must reset.
- "Put `ON DELETE CASCADE` from documents → auth.users" → no FK should reach Tier A.
