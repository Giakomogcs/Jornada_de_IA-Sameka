---
name: n8n-langchain-prompt
description: "Author the LangChain Agent node's systemMessage with the 7-section skeleton (Identidade, Objetivo, Contexto, Ferramentas, Política, Restrições, Formato, Memória), wire the <user_context> injection from the front, and register tool descriptions that drive correct tool picking. USE WHEN designing or rewriting the agent persona, fixing 'the agent picks the wrong tool', 'the agent invents data', 'the agent ignores the user role', or shipping a new agent persona. Includes ready-to-paste pre-step JS that parses <user_context> tags."
argument-hint: "Provide: brand_display, persona, agent_language, list of tools with one-line purposes, profile (MINIMAL/STANDARD/FULL)"
---

# LangChain Agent Prompt & Context Injection

How to write the LangChain `agent` node's `systemMessage` so the agent picks tools correctly, respects the user role, and renders the right blocks in the front.

## When to Use

- "Write the system prompt for the new agent"
- "The agent calls the wrong tool"
- "The agent hallucinates data that should come from a subflow"
- "The agent doesn't know who the user is"
- "Add a new role / new tool to an existing agent"

## Do NOT Use For

- Choosing the LLM model (provider settings)
- Embedding / retrieval tuning (use `n8n-rag-stable-id`)

## The 7-Section Skeleton (ALL required)

A 1-line system prompt is the #1 quality killer. Always fill all 7 sections.

```
# Identidade
Você é o assistente <Brand> para <persona>. Fala <agent_language> (pt-BR por padrão).

# Objetivo
<frase única, mensurável, no presente>. Ex: "Ajudar representantes a fechar pedidos B2B com base no catálogo e tabela de preços vigentes."

# Contexto do usuário
A cada turno você recebe um bloco <user_context> com:
- nome: <full_name>
- role: <role>
- company_name: <tenant>
- <campos específicos do domínio> (ex: estados, cidades, especialidade)
- session_id: <uuid>
- ts: <iso>

Use SEMPRE esses dados ao montar respostas. Nunca pergunte algo que já está no contexto.

# Ferramentas disponíveis
- <tool_name_1>: <quando usar — 1 frase>. Entrada: { <campos> }.
- <tool_name_2>: <quando usar>. Entrada: { ... }.
- search_knowledge_base: consultar a base RAG quando o usuário fizer perguntas sobre <domínio>. Entrada: { query: string, top_k?: int }.
(uma linha por tool, casando 1:1 com os subflows registrados)

# Política de uso de ferramentas
1. SEMPRE consulte `search_knowledge_base` antes de afirmar fatos sobre <domínio>.
2. Para dados estruturados (preços, estoque, leads), use a tool específica — NUNCA invente.
3. Se faltar parâmetro obrigatório, pergunte ao usuário em UMA mensagem (lista numerada).
4. Em caso de erro de tool (`ok:false`), informe ao usuário em linguagem simples e sugira próximo passo.
5. Não chame a mesma tool duas vezes com a mesma entrada na mesma resposta.

# Restrições
- Nunca exponha segredos, IDs internos, SQL, ou nomes de tools no texto final.
- Nunca prometa ações fora dos tools (ex: enviar email se não houver tool de email).
- Respeite o role:
  - admin: pode pedir relatórios completos, ver outros usuários.
  - <role 2>: limites específicos.
  - <role 3>: somente leitura.
- (MINIMAL/STANDARD sem login real): assuma role=admin.

# Formato de resposta
- Markdown.
- Listas curtas; evite parágrafos longos.
- Para <tipo de dado especial>, retorne fenced block ```<brand>-<tipo>\n<json>\n``` para o front renderizar. Tipos possíveis: `<brand>-leads`, `<brand>-product-images`, `<brand>-info-box`.
- Cite a fonte quando vier do RAG: `[fonte: <title>]`.

# Memória
- Continue a conversa com base no histórico desta sessão (sessão = `session_id`).
- Não repita perguntas já respondidas.
- Quando o usuário trocar de assunto, recapitule em 1 linha o contexto anterior antes de seguir.
```

## `<user_context>` Block

The front injects this block **before** the user message in every POST to `/<NS>-AgentRag`:

```
<user_context>
nome: João Silva
role: representante
company_name: acme
estados: ["SP","RJ"]
cidades: ["São Paulo","Rio de Janeiro"]
session_id: 7c1f…
ts: 2026-05-15T13:42:00Z
</user_context>

<user_message>
me mostre os leads novos em São Paulo
</user_message>
```

The LangChain Agent node needs a pre-step Code node that parses these tags and passes the parsed object into the prompt template.

### Pre-step Code (paste into a `Code` node before the Agent)

```js
const raw = $json.body?.message ?? $json.message ?? '';
const ctxMatch = raw.match(/<user_context>([\s\S]*?)<\/user_context>/);
const msgMatch = raw.match(/<user_message>([\s\S]*?)<\/user_message>/);

const user_context = {};
if (ctxMatch) {
  for (const line of ctxMatch[1].trim().split('\n')) {
    const [k, ...rest] = line.split(':');
    if (!k) continue;
    const v = rest.join(':').trim();
    try { user_context[k.trim()] = JSON.parse(v); }
    catch { user_context[k.trim()] = v; }
  }
}

return [{
  json: {
    user_context,
    user_message: (msgMatch ? msgMatch[1] : raw).trim(),
    session_id: user_context.session_id || $json.body?.session_id,
  }
}];
```

In the Agent node:
- `Prompt (User)` field: `{{$json.user_message}}`
- `System Message`: paste the 7-section skeleton, with `{{$json.user_context | json}}` injected inside the "Contexto do usuário" section, e.g.:

```
# Contexto do usuário (sessão atual)
```json
{{$json.user_context}}
```
```

## Tool Description Rules

The Agent picks tools by their description. A vague description = wrong tool. For every tool registered on the Agent node:

| Field | Rule |
|---|---|
| `name` | `snake_case`, short, brand-prefixed if it could collide (`acme_get_leads`). |
| `description` | 1+ sentence including: **what it does**, **when to use it**, **what NOT to use it for**. Mention input contract inline. |
| `inputSchema` | JSON Schema with `required` fields, `type`, `description` per field. |

Template:

```
get_leads_by_city: Retorna leads B2B de uma cidade.
USE WHEN o usuário pede leads, prospects, ou empresas em uma cidade específica.
DO NOT USE para clientes existentes (use get_customer) nem para dados consolidados (use sales_report).
Input: { cidade: string (obrigatório), estado: string (UF), limit?: int (default 50) }.
Output: { ok, data: [{nome, cnpj, cidade, estado, segmento}], error? }.
```

## Mapping Tools 1:1 to Subflows

For every tool you register in the Agent node there MUST be a subflow with the same input/output contract (`{ok, data, error}`). If a tool isn't backed by a subflow, the Agent will hallucinate. Load `n8n-tool-contract` for the subflow side.

## Special Output Blocks (front rendering)

If your front renders rich UI from chat (lead cards, product carousels), reserve fenced code block tags:

| Tag | Purpose |
|---|---|
| ` ```<brand>-leads ` | Array of lead objects → renders as cards |
| ` ```<brand>-product-images ` | Array of `{title, url}` → renders as carousel |
| ` ```<brand>-info-box ` | `{title, body}` → renders as callout |

Document the JSON shape in the System Prompt's "Formato de resposta" section so the model knows the schema.

## Quality Bar

- [ ] All 7 sections present.
- [ ] `Contexto do usuário` references the actual `<user_context>` fields injected by the front.
- [ ] Every tool has `name`, `description` with WHEN/WHEN-NOT, and `inputSchema`.
- [ ] No tool description shorter than one full sentence.
- [ ] Policy section says "use RAG before stating facts" if RAG exists.
- [ ] Restrictions list role limits (omit only in MINIMAL with no roles).
- [ ] Pre-step Code node parses `<user_context>` and `<user_message>` and passes structured data to the Agent.
- [ ] Special block tags (if any) are documented in the prompt.

## Anti-patterns

- "Você é um assistente prestativo." → vague, expect random tool picks.
- "Use as ferramentas disponíveis." → without telling the model **when**, it won't.
- Tool description `Get leads.` → 3 words. The model can't pick correctly.
- Prompting in English when `agent_language=pt-BR` → degrades pt-BR output quality.
- Putting tool input examples only in the `inputSchema` (the Agent reads description first).
- Re-injecting the full chat history in the system prompt every turn (use the memory node).
