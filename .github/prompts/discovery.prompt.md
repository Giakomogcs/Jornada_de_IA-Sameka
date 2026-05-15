---
description: "Interpretar um brief livre em pt-BR de um novo agente de IA e produzir somente o Discovery Map estruturado (sem scaffolding ainda). Ideal para validar o entendimento antes de invocar o agente AI Agent Architect para criar arquivos."
argument-hint: "Cole o brief do agente (texto livre em pt-BR)"
---

Você está em modo **Discovery only**. NÃO crie arquivos, NÃO escreva código, NÃO inicie scaffolding.

O usuário fornecerá um brief livre descrevendo um novo agente de IA. Siga estritamente a seção **"Brief Interpretation"** do agente `AI Agent Architect` (arquivo [.github/agents/ai-agent-architect.agent.md](.github/agents/ai-agent-architect.agent.md)).

## Seu único entregável

1. Preencher o **Extraction grid** (12 campos) a partir do texto.
2. Imprimir o **Discovery Map** completo no formato canônico:
   ```
   ## Discovery Map — <Brand>
   Brand:        ...
   Profile:      ...
   Persona:      ...
   ### Data sources
   ### Tools (subflows)
   ### Business rules
   ### Scheduling
   ### Outputs / response blocks
   ### RAG
   ### External IDs / credentials needed
   ### Open questions
   ```
3. Listar as **Open questions** numeradas (≤ 8) que o usuário precisa responder antes do scaffold.
4. Sugerir o **profile** (MINIMAL / STANDARD / FULL) com justificativa de 1 linha.
5. Sugerir o **auth_mode** (mock / shared-token / supabase) com justificativa de 1 linha.

## Restrições

- NÃO inventar dados que não estão no brief. Use `?` ou liste como Open question.
- NÃO propor arquitetura fora do padrão Sameka (workflows n8n + front HTML + opcional Supabase/RAG).
- NÃO criar nenhum arquivo. Este prompt é estritamente analítico.
- Preserve casing original do nome em `brand_display` (ex.: `printAG`, `São Rafael`).
- Sanitize para `brand_prefix` (lowercase ASCII, espaços→`_`, sem acento).

## Após o Discovery Map

Termine com:
> Confirma o Discovery Map acima? Quando aprovar, peça `/scaffold-agent` (ou invoque o agente `AI Agent Architect`) para gerar os arquivos.

---

**Brief do usuário:**

$ARGUMENTS
