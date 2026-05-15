---
name: n8n-credential-placeholders
description: "Manage external IDs, API keys, and credentials for a new agent: which values must be provided by the user (Drive folder/file IDs, Supabase URL/keys, OpenAI key, shared tokens), which are generated locally, where each one belongs (n8n credentials vs front constant vs .env), and how to mark missing values with __FILL_ME__ placeholders that the Runbook lists at the end. USE WHEN scaffolding a new agent, auditing what's missing before deploy, fixing 'service role key leaked to front', or onboarding a new tenant."
argument-hint: "Provide: profile, brand_prefix, list of external integrations (Drive, Sheets, external APIs)"
---

# Credentials & External ID Management

How to handle every secret / external ID in a new agent: where it goes, who provides it, how to mark it missing.

## When to Use

- "Scaffold a new agent"
- "What do I need from the client before deploying?"
- "Audit what's still missing"
- "Service role key showed up in the front bundle"
- "Onboard a new tenant"

## Do NOT Use For

- Designing the auth flow itself (use `supabase-auth`)
- Setting up the n8n credential store backend

## Three Locations, Strict Rules

| Location | What goes here | What MUST NOT go here |
|---|---|---|
| **n8n credentials** | All API keys, Postgres password, OpenAI key, Drive OAuth, Service Role Key | — |
| **Front constants** (in `app.js` / inline) | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `API_BASE`, `BRAND_PREFIX` | Service Role Key, Postgres password, OpenAI key, any token longer than the anon JWT |
| **`.env.example` (committed)** + **`.env` (gitignored)** | Drive folder/file IDs, Sheets IDs, public URLs, dev-only tokens | Production secrets that should live in n8n credentials |

Rule of thumb: **if it can call admin RPCs or charge money, it lives only in n8n credentials.**

## The Master Checklist

Group the values your agent needs by profile + integration set.

### Always needed

| Key | Where | Who provides |
|---|---|---|
| `BRAND_PREFIX` | front constant + SQL | architect (auto from brief) |
| `API_BASE` | front constant | architect (depends on deploy URL) |
| `AGENT_SHARED_TOKEN` (if `auth_mode != supabase`) | n8n credential `Header Auth <Brand>` + front constant | architect generates `openssl rand -hex 32` |

### LLM / Embeddings

| Key | Where | Who provides |
|---|---|---|
| `OPENAI_API_KEY` (or other provider) | n8n credential | **user** (provider dashboard) |
| `EMBEDDINGS_API_KEY` (if separate) | n8n credential | **user** |
| Model name (`gpt-4o`, `claude-3-5-sonnet`, …) | Agent node parameter | architect proposes, user confirms |

### Supabase (STANDARD with chat / FULL)

| Key | Where | Who provides |
|---|---|---|
| `SUPABASE_URL` | front constant + n8n credential | **user** (Supabase → Settings → API) |
| `SUPABASE_ANON_KEY` | front constant + n8n credential | **user** (idem) |
| `SUPABASE_SERVICE_ROLE_KEY` | **n8n credential ONLY** | **user** (idem) |
| `POSTGRES_HOST/PORT/DB/USER/PASSWORD` | n8n credential `Postgres <Brand>` | **user** (Supabase → Database → Connection Pooling) |

### Google Drive (when RAG on Drive OR Drive subflows)

| Key | Where | Who provides |
|---|---|---|
| Google OAuth credentials | n8n credential (built-in OAuth flow) | **user** runs OAuth in n8n |
| `DRIVE_FOLDER_ID_RAG` | n8n credential/env | **user** (URL of dedicated RAG folder) |
| `DRIVE_FOLDER_ID_<OTHER>` (uploads, sheets) | n8n credential/env | **user** (one per non-RAG folder) |
| `DRIVE_FILE_ID_<DOC>` (one per RAG doc) | n8n credential/env | **user** (URL of each file inside RAG folder) |

### Google Sheets (when sheets subflows exist)

| Key | Where | Who provides |
|---|---|---|
| `GOOGLE_SHEETS_ID_<NAME>` | n8n credential/env | **user** |
| Sheets OAuth | n8n credential | **user** |

### External APIs (per integration)

| Key | Where | Who provides |
|---|---|---|
| `<API>_TOKEN` / `<API>_URL` / `<API>_USER+PASS` | n8n credential | **user** |
| OpenAPI yaml in repo (`<api>.yaml`) | repo root | architect (from provider docs) |

### Deploy

| Key | Where | Who provides |
|---|---|---|
| Netlify site name | `netlify.toml` | **user** (Netlify dashboard) |
| Custom domain | DNS + Netlify | **user** |

## `__FILL_ME__` Placeholder Convention

When a value isn't known at scaffold time, **never invent it**. Drop a placeholder:

```
DRIVE_FOLDER_ID_RAG=__FILL_ME__DRIVE_FOLDER_ID_RAG__
DRIVE_FILE_ID_CATALOGO=__FILL_ME__DRIVE_FILE_ID_CATALOGO__
SUPABASE_URL=__FILL_ME__SUPABASE_URL__
```

Pattern: `__FILL_ME__<UPPERCASE_KEY>__`. The double underscore + uppercase makes it `grep`-able and visually obvious.

At the end of the run, produce a **Pending Configuration** section in the Runbook:

```
## Pending Configuration

The following placeholders remain. Fill them before activating workflows:

netlify/app.js:
  - __FILL_ME__SUPABASE_URL__
  - __FILL_ME__SUPABASE_ANON_KEY__

.env:
  - __FILL_ME__DRIVE_FOLDER_ID_RAG__
  - __FILL_ME__DRIVE_FILE_ID_CATALOGO__

n8n credentials to create:
  - "Postgres <Brand>"      (host/port/db/user/password)
  - "OpenAI <Brand>"        (OPENAI_API_KEY)
  - "Google Drive <Brand>"  (OAuth)
  - "Header Auth <Brand>"   (AGENT_SHARED_TOKEN — value below)
```

## `.env.example` Template (always commit this)

```
# Front-public (safe to ship in bundle)
BRAND_PREFIX=__FILL_ME__BRAND_PREFIX__
API_BASE=__FILL_ME__API_BASE__
SUPABASE_URL=__FILL_ME__SUPABASE_URL__
SUPABASE_ANON_KEY=__FILL_ME__SUPABASE_ANON_KEY__

# Server-only (NEVER commit values; mirror into n8n credentials)
SUPABASE_SERVICE_ROLE_KEY=__FILL_ME__SUPABASE_SERVICE_ROLE_KEY__
POSTGRES_PASSWORD=__FILL_ME__POSTGRES_PASSWORD__
OPENAI_API_KEY=__FILL_ME__OPENAI_API_KEY__
AGENT_SHARED_TOKEN=__FILL_ME__AGENT_SHARED_TOKEN__

# Drive IDs (provided by user)
DRIVE_FOLDER_ID_RAG=__FILL_ME__DRIVE_FOLDER_ID_RAG__
# DRIVE_FILE_ID_<DOC>=...
```

Add `.env` to `.gitignore`. Never read `.env` from the front bundle directly; the front gets its values inlined at build time by the sync script, and only the safe set.

## Generated-Locally Values

Some values the architect generates without asking the user:

| Value | How |
|---|---|
| `AGENT_SHARED_TOKEN` | `openssl rand -hex 32` (or `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| Workflow UUIDs | n8n assigns on import; not needed at scaffold time |
| `idempotency_key` per call | front generates `crypto.randomUUID()` |
| `session_id` | front generates `crypto.randomUUID()` per chat session |

## Drive ID Acquisition Procedure (give to the user verbatim)

```
1. Abra o Google Drive na conta que será dona dos arquivos.
2. Crie UMA pasta nova chamada "<Brand> — RAG" (não use uma pasta existente).
3. Compartilhe a pasta com a service account do n8n (email do OAuth).
4. Abra a pasta. A URL será: https://drive.google.com/drive/folders/<FOLDER_ID>
   → o ID é o trecho após /folders/. Copie. Esse é DRIVE_FOLDER_ID_RAG.
5. Para cada documento do RAG:
   a) Faça upload UMA vez dentro dessa pasta.
   b) Abra o arquivo no Drive. URL: https://docs.google.com/.../d/<FILE_ID>/edit
   c) Copie o <FILE_ID> e cadastre como DRIVE_FILE_ID_<NOME_EM_MAIUSCULAS>.
6. Daqui em diante, NÃO delete nem renomeie esses arquivos. Atualizações usam o subflow "Drive Content Replace".
```

## Quality Bar

- [ ] No production secret hardcoded in any file under `netlify/` or `front-*.html`.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` only appears in `.env.example` (as placeholder) and n8n credentials description — never in source code.
- [ ] `.env.example` committed; `.env` gitignored.
- [ ] Every external ID is either filled or marked `__FILL_ME__<KEY>__`.
- [ ] Runbook lists every remaining `__FILL_ME__` grouped by file and by n8n credential to create.
- [ ] `DRIVE_FOLDER_ID_RAG` is documented as a **dedicated** folder (see `n8n-rag-stable-id`).
- [ ] `AGENT_SHARED_TOKEN` (if used) was generated locally and recorded in the Runbook for the user to paste into n8n.
- [ ] No `node_modules`, no `.env`, no `*.key`, no `*.pem` committed.

## Anti-patterns

- Inventing a 33-char Drive ID because the user didn't have one handy → silent failure when the watcher hits 404.
- `SUPABASE_SERVICE_ROLE_KEY` inlined in `app.js` "for testing" → full DB takeover by any visitor.
- Committing `.env` with real values → secret leak.
- Reusing the same `DRIVE_FOLDER_ID_RAG` across tenants → cross-tenant data leak.
- Mixing user-provided secrets and architect-generated ones without labeling → operator can't tell who owns what.
- Skipping the `.env.example` because "the user will figure it out" → onboarding breaks.
