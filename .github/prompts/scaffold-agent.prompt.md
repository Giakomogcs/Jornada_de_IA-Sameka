---
description: "Disparar o scaffold completo de um novo agente de IA seguindo o padrão Sameka. Invoca o agente AI Agent Architect com um brief já interpretado (idealmente após /discovery). Cria todos os arquivos do novo repositório."
argument-hint: "Brief do agente OU 'continue do Discovery Map confirmado anteriormente'"
---

Você está em modo **Scaffold**. Invoque o agente **AI Agent Architect** ([.github/agents/ai-agent-architect.agent.md](.github/agents/ai-agent-architect.agent.md)) e siga TODAS as fases dele:

1. **Brief Interpretation** — se ainda não foi feito via `/discovery`, faça agora e peça confirmação.
2. **Triage** — pergunta consolidada por parâmetros faltantes (≤ 8 itens).
3. **Confirm target repo** — pergunte ao usuário o caminho absoluto do repositório novo. **NÃO** escreva dentro do repo Sameka.
4. **Plan with `todo`** — fases filtradas pelo profile.
5. **Repository File Map** — apresente a árvore completa e peça `ok`.
6. **Scaffold** lendo + reescrevendo os arquivos de referência do Sameka.
7. **Verify** com `grep_search` (zero `sameka`/`Sameka`/`SAMEKA`/`[Sameka]`; zero `CASCADE`/`DROP TABLE`; zero secrets vazados no front).
8. **Runbook final** com placeholders `__FILL_ME__*` agrupados.

## Skills obrigatórias a carregar antes de scaffolddar

- `n8n-langchain-prompt` — system prompt do main agent
- `n8n-tool-contract` — cada subflow
- `n8n-credential-placeholders` — `.env.example` e Drive IDs
- `n8n-front-injection` — front + Netlify split + sync scripts
- `n8n-reset-safety` — se STANDARD/FULL (migrations/RAG)
- `n8n-rag-stable-id` — se RAG ligado
- `supabase-auth` — se `auth_mode=supabase`
- `n8n-workflow-rewrite` — para clonar JSONs do Sameka

## Use Context7 quando

- Precisar de sintaxe atual de um node n8n não visto no Sameka.
- Configurar Supabase JS v2, Drive API, pgvector, SDK de LLM, Netlify.

## NÃO

- Não escreva nada antes da confirmação do **Discovery Map** e do **Repository File Map**.
- Não invente IDs externos; use `__FILL_ME__*`.
- Não use `DROP CASCADE` em nenhum lugar.
- Não delete arquivos do Drive; use o subflow Drive Content Replace no mesmo `file_id`.
- Não coloque service-role key, Postgres password ou tokens longos em `netlify/*` ou `front-*.html`.

---

**Entrada do usuário:**

$ARGUMENTS
