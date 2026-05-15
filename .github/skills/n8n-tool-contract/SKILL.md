---
name: n8n-tool-contract
description: "Define the input/output contract of every n8n subflow exposed to a LangChain Agent as a tool. Enforces executeWorkflowTrigger with JSON Schema input, {ok,data,error} response shape, idempotency keys for writes, structured logging, retries on the caller side, and a workspaces/README.md catalog. USE WHEN adding a new tool to the agent, debugging 'the agent calls the tool with wrong args', 'the agent ignores tool errors', or auditing existing subflows."
argument-hint: "Provide: brand_tag, list of tools to define (name + purpose), profile"
---

# n8n Subflow Tool Contract

Every subflow that the main LangChain Agent invokes via `Execute Workflow` is a **tool**. Tools without a contract make the agent unreliable. This skill defines the contract and shows how to enforce it.

## When to Use

- "Add a new tool to the agent"
- "The agent invents arguments / calls tools with wrong shape"
- "The agent ignores tool errors"
- "Tools succeed but the agent says it failed (or vice versa)"
- "Audit our subflow consistency"

## Do NOT Use For

- Writing the Agent's system prompt (use `n8n-langchain-prompt`)
- Designing the RAG retrieval tool internals (use `n8n-rag-stable-id`)

## The Contract (6 rules)

Every subflow exposed as a tool MUST:

### 1. Have an `executeWorkflowTrigger` with declared JSON Schema input

```json
{
  "type": "object",
  "required": ["cidade", "estado"],
  "properties": {
    "cidade": { "type": "string", "description": "Nome completo da cidade" },
    "estado": { "type": "string", "description": "UF de 2 letras" },
    "limit":  { "type": "integer", "default": 50, "minimum": 1, "maximum": 200 },
    "idempotency_key": { "type": "string", "description": "Opcional para writes" }
  }
}
```

Register this schema both on the trigger node and in the parent Agent's tool definition. Mismatched schemas = mismatched calls.

### 2. Return EXACTLY this envelope (no exceptions)

```json
{ "ok": true,  "data": <any>, "error": null }
```
or
```json
{ "ok": false, "data": null, "error": "<short human message>" }
```

- Never return a bare string.
- Never return an array at the root.
- Never return `200` with an error in `data`.
- The `Respond to Webhook` / `Execute Workflow Return` node uses this exact shape.

### 3. Be idempotent (reads always; writes via `idempotency_key`)

- Reads can be retried freely. Side-effect-free.
- Writes accept `idempotency_key`. Same key + same input within a TTL window returns the original result without re-executing.

Implementation for writes:
```js
// First node after trigger
const key = $json.idempotency_key;
if (key) {
  const cached = /* SELECT result FROM <prefix>_idempotency WHERE key=$1 AND created_at > now() - interval '24h' */;
  if (cached) return [{ json: { ...cached, _replay: true } }];
}
// ... do the work ...
// Last node, before respond:
if (key) /* INSERT INTO <prefix>_idempotency(key, result) VALUES (...) ON CONFLICT DO NOTHING */;
```

(Optional Tier A table `<prefix>_idempotency(key text PRIMARY KEY, result jsonb, created_at timestamptz DEFAULT now())`.)

### 4. Log structured input at entry

First node inside the subflow (right after the trigger) is a `Code` node that logs:
```js
const log = {
  tool: '<subflow_name>',
  session_id: $json.session_id ?? null,
  user_id:    $json.user_id    ?? null,
  input:      $json,
  ts: new Date().toISOString()
};
console.log(JSON.stringify(log));
return $input.all();
```

This makes debugging the agent's tool picks possible.

### 5. Be called with `Continue On Fail = true` and bounded retries

From the main Agent's perspective:
- The `Execute Workflow` invocation has `Continue On Fail = true` so the Agent receives the `{ok:false}` envelope instead of crashing the run.
- Read-tools: retry up to 2 times with exponential backoff on transient failures (network, 5xx).
- Write-tools: no retry without an `idempotency_key`.

### 6. Be described 1:1 in `workspaces/README.md`

The repo MUST contain a `workspaces/README.md` with one table:

| Tool name | File | Trigger path / WF ID | Inputs | Outputs (data shape) | Idempotent | Notes |
|---|---|---|---|---|---|---|
| `get_leads_by_city` | `[Acme] GET-Leads.json` | `executeWorkflowTrigger` | `{cidade, estado, limit?}` | `[{nome, cnpj, cidade, estado, segmento}]` | yes (read) | external Oporttuna API |
| `replace_drive_doc` | `[Acme] Sub-fluxo_ Drive Content Replace.json` | `executeWorkflowTrigger` | `{file_id, new_content, mime, idempotency_key}` | `{file_id, chunks_inserted}` | yes (key) | RAG-folder validated |

This table is the source of truth when the Agent's `systemMessage` lists tools.

## Subflow Skeleton (paste this)

```
[ Execute Workflow Trigger ]   (input schema declared)
        │
[ Code: log input ]
        │
[ Code: idempotency check (writes only) ]
        │
[ ... business logic nodes ... ]
        │
[ Code: build envelope ]
   return [{
     json: { ok: true, data: <result>, error: null }
   }];
        │
[ Code: idempotency record (writes only) ]
        │
[ End: Workflow returns $json ]
```

For error paths:
```js
// Catch node or IF branch
return [{
  json: {
    ok: false,
    data: null,
    error: errorMessage.slice(0, 200)  // bounded length
  }
}];
```

## Registering the Tool on the Agent

In the LangChain Agent node, under "Tools":

```yaml
- name: get_leads_by_city
  description: |
    Retorna leads B2B em uma cidade.
    USE WHEN o usuário pede leads, prospects, empresas ou contatos comerciais em uma cidade.
    DO NOT USE para clientes existentes (use get_customer) ou agregados (use sales_report).
    Input: { cidade: string obrigatório, estado: UF obrigatório, limit?: int (1-200, default 50) }.
    Output: { ok, data: [{nome, cnpj, cidade, estado, segmento}], error? }.
  workflowId: <UUID of [Acme] GET-Leads workflow>
  schema: <paste JSON Schema from rule #1>
```

Cross-check the `description` against the Agent's `systemMessage` "Ferramentas disponíveis" section — they must match.

## Anti-patterns

- Returning `{ data: [...] }` (no `ok`, no `error`) → agent can't distinguish success/failure.
- Returning `null` on "not found" → indistinguishable from error. Return `{ok:true, data:[], error:null}`.
- Different envelopes across subflows → agent learns to ignore the shape.
- Throwing from the subflow instead of returning `{ok:false, error}` → with `Continue On Fail=false` this crashes the Agent run.
- Tool description `Gets the leads.` → no WHEN/WHEN-NOT, agent picks it randomly.
- Same tool registered twice with slightly different names → agent oscillates.
- Free-form `text` input field instead of structured schema → agent passes natural language and the subflow tries to parse it.

## Quality Bar

- [ ] Every subflow returns `{ok, data, error}` exactly.
- [ ] Every subflow has an input JSON Schema on its trigger.
- [ ] Every tool description on the Agent node has WHEN + WHEN-NOT + Input + Output.
- [ ] Every write-tool accepts `idempotency_key`.
- [ ] First node inside every subflow logs structured input.
- [ ] `Execute Workflow` nodes use `Continue On Fail = true`.
- [ ] `workspaces/README.md` lists every tool with file, inputs, outputs, idempotency.
- [ ] Tool names match between Agent registration, subflow filename prefix, and README.
