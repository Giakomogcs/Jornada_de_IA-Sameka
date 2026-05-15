---
name: n8n-reset-safety
description: "Design a database setup and reset strategy where re-running the schema/RAG setup never wipes user data, chat history, or admin RPCs. Enforces Tier A (migrations) vs Tier B (n8n setup) separation, bans DROP CASCADE, mandates idempotent DDL, requires TRUNCATE-only purges, and adds tenant guards on destructive nodes. USE WHEN designing the migration set, the DB-Schema-Setup workflow, the rag-purge endpoint, or fixing 'every reset wipes my users / chat history'."
argument-hint: "Provide: brand_prefix, tenant_company, profile (STANDARD/FULL — MINIMAL skips)"
---

# Reset-Safe Database Design

How to organize SQL and n8n DDL so the agent can be re-deployed, re-configured, and partially reset without ever losing persistent user data or chat history.

## When to Use

- "Set up the migrations"
- "Reset RAG without losing users"
- "Re-running the setup workflow drops my chat tables"
- "Make the DB setup safe to run on every deploy"

## Do NOT Use For

- Single-table feature design
- Application-level state (use the front's storage)

## Core Rule: Two Tiers, Never Mixed

| Tier | Owner | Examples | Reset semantics |
|---|---|---|---|
| **Tier A — Persistent** | `migrations/*.sql` ONLY | users metadata, roles, `<prefix>_chat_message`, `<prefix>_chat_session`, admin RPCs, `<prefix>_is_admin`, `<prefix>_schema_migrations` | Never dropped. Only `ALTER` via new migration. |
| **Tier B — Regenerable** | `<Brand>-DB-Schema-Setup.json` n8n workflow ONLY | `<prefix>_documents`, `<prefix>_document_metadata`, `<prefix>_document_rows`, `match_<prefix>_documents`, indexes | Safe to TRUNCATE; tables themselves are idempotently re-created. |

**A single SQL statement that touches both tiers is a bug.**

## Hard Rules

### SQL

1. **No `DROP ... CASCADE`** anywhere in n8n. Period.
2. **No `ON DELETE CASCADE` on FKs pointing at `auth.users`**. Use `ON DELETE SET NULL`. Tier-B-internal cascades are OK.
3. **All DDL idempotent**: `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE EXTENSION IF NOT EXISTS vector`.
4. **`DO $$ ... END $$` blocks** for policies/triggers where `IF NOT EXISTS` isn't available:
   ```sql
   DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = '<prefix>_p_read') THEN
       CREATE POLICY ...;
     END IF;
   END $$;
   ```
5. Every migration file ends with `NOTIFY pgrst, 'reload schema';`.
6. **Re-runnable end-to-end**: running 001…N twice produces no errors and no diff.
7. **Version tracking**: migration 001 creates
   ```sql
   CREATE TABLE IF NOT EXISTS <PREFIX>schema_migrations (
     version    text PRIMARY KEY,
     applied_at timestamptz NOT NULL DEFAULT now()
   );
   ```
   Every later migration ends with:
   ```sql
   INSERT INTO <PREFIX>schema_migrations(version) VALUES ('002') ON CONFLICT DO NOTHING;
   ```
8. **Migration header** (mandatory):
   ```sql
   -- file: 003_admin_guards.sql
   -- tier: A
   -- purpose: add <prefix>_is_admin() + admin guards on all admin RPCs
   -- depends: 001, 002
   -- reversible: no
   ```

### n8n

1. `<Brand>-DB-Schema-Setup.json` may **only** touch Tier B. Mentioning a Tier A table = bug.
2. Purge endpoints use **`TRUNCATE ... RESTART IDENTITY`**, never `DROP`:
   ```sql
   TRUNCATE
     <prefix>_documents,
     <prefix>_document_rows,
     <prefix>_document_metadata
     RESTART IDENTITY;
   ```
3. Every destructive node starts with a **tenant guard** Code node:
   ```js
   const expected = $env.EXPECTED_DB_NAME ?? '<tenant>_db';
   const conn = $('Postgres Get DB Name').first().json.current_database;
   if (conn !== expected) {
     throw new Error(`Refused: connected to ${conn}, expected ${expected}`);
   }
   return $input.all();
   ```
4. RAG reset webhooks return `{ok, rows_purged}` — never confirm by silence.
5. No setup workflow runs unattended on schedule. Reset is an explicit `POST /<ns>-rag-purge-all` call.

## Migration Template

```sql
-- file: 00X_<short_name>.sql
-- tier: A
-- purpose: <one line>
-- depends: 00X-1
-- reversible: yes/no

BEGIN;

-- 1) DDL (idempotent)
CREATE TABLE IF NOT EXISTS <prefix>_xyz (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2) RPC (SECURITY DEFINER + explicit search_path + admin guard)
CREATE OR REPLACE FUNCTION <prefix>_xyz_list()
RETURNS SETOF <prefix>_xyz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT <prefix>_is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM <prefix>_xyz ORDER BY created_at DESC;
END $$;

GRANT EXECUTE ON FUNCTION <prefix>_xyz_list() TO authenticated;

-- 3) Track version
INSERT INTO <prefix>_schema_migrations(version) VALUES ('00X') ON CONFLICT DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
```

## DB-Schema-Setup Workflow Template

Inside `<Brand>-DB-Schema-Setup.json`:

- Webhook `POST /<ns>-rag-schema-setup`
- Code: tenant guard (refuse if DB name doesn't match)
- Postgres: run the Tier B SQL block (extension, tables, function, indexes — all `IF NOT EXISTS` / `CREATE OR REPLACE`)
- Respond: `{ ok:true, tier:"B", tables_ensured: [...] }`

Body of the Postgres node is taken verbatim from `n8n-rag-stable-id` SKILL's Tier B Schema section.

## Purge Endpoint Template

`POST /<ns>-rag-purge-all`:
```
1. tenant guard
2. Postgres:
   TRUNCATE <prefix>_documents, <prefix>_document_rows, <prefix>_document_metadata RESTART IDENTITY;
3. respond { ok:true, rows_purged: <count> }
```

**Never** add a "purge all including users" endpoint. If the operator truly wants a clean slate, they drop the entire Supabase project and re-run migrations.

## Verification

```sql
-- 1) Re-runnable check (run twice, second run must succeed silently)
\i migrations/001_user_crud_functions.sql
\i migrations/001_user_crud_functions.sql  -- no errors expected

-- 2) Tier separation check
SELECT proname FROM pg_proc WHERE proname LIKE '<prefix>_%';
-- The DB-Schema-Setup workflow must NOT recreate any of these.

-- 3) No CASCADE to auth.users
SELECT conname FROM pg_constraint
WHERE confrelid = 'auth.users'::regclass AND confdeltype = 'c';
-- Expected: zero rows.
```

In n8n JSON:
```
grep -i "DROP TABLE" workspaces/*.json   → zero
grep -i "CASCADE"    workspaces/*.json   → zero
grep -i "auth.users" workspaces/<Brand>-DB-Schema-Setup.json → zero
```

## Quality Bar

- [ ] All Tier A objects defined exclusively in `migrations/`.
- [ ] All Tier B objects defined exclusively in `<Brand>-DB-Schema-Setup.json`.
- [ ] Every migration re-runs cleanly twice in a row.
- [ ] Every migration ends with `NOTIFY pgrst, 'reload schema';`.
- [ ] `<prefix>_schema_migrations` table exists and is populated.
- [ ] No `DROP ... CASCADE` in any n8n JSON.
- [ ] No `ON DELETE CASCADE` on FKs to `auth.users`.
- [ ] Tenant guard Code node precedes every destructive Postgres node.
- [ ] Purge endpoint uses `TRUNCATE ... RESTART IDENTITY`, returns row count.
- [ ] Admin RPCs are `SECURITY DEFINER` + explicit `search_path` + `<prefix>_is_admin()` guard.

## Anti-patterns

- "DROP TABLE … CASCADE; CREATE TABLE …" in a setup node → wipes user data via Tier-A FKs.
- Mixing user table creation with vector table creation in one SQL block → can't reset one without the other.
- `ON DELETE CASCADE` from chat_message → auth.users → deleting an Auth user nukes their history.
- Running the migrations directory via the n8n setup workflow → blurs the tiers.
- Non-idempotent migration (`CREATE TABLE <prefix>_x` without `IF NOT EXISTS`) → second deploy fails.
- "Quick fix: just `psql -c 'DROP SCHEMA public CASCADE'`" → never. That's the disaster you're trying to prevent.
