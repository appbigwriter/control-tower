---
name: gestaodb-control-tower
description: >-
  Gerencia o ciclo de vida completo de projetos e bancos no GestaoDB / Control Tower.
  Use sempre que o usuário ou fluxo de trabalho solicitar provisionar novos bancos e schemas
  (blog, store, saas, custom), listar o portfólio de projetos ativos, gerar documentos técnicos
  de handoff (Developer Doc, BigWriter, Frontend/AdSense), executar migrações SQL em schemas isolados
  ou arquivar/excluir bancos de dados.
---

# GestaoDB - Control Tower Agent Skill

Esta skill capacita agentes virtuais (Hermes, Antigravity, automações n8n ou CLI) a operar autonomamente o **GestaoDB / Control Tower**, central de governança, catálogo e provisionamento multi-tenant de bancos de dados PostgreSQL/Supabase.

---

## 1. Princípios de Arquitetura & Governança

1. **Catálogo Central (`public`):**
   - As tabelas do schema `public` (`projects`, `organizations`, `provisioning_jobs`, `audit_logs`) pertencem à governança central.
   - **Regra inegociável:** Agentes de projetos/aplicações **NUNCA** devem criar, alterar ou excluir tabelas do schema `public`.
2. **Multi-tenancy por Schema Dedicado:**
   - Cada projeto recebe um schema PostgreSQL isolado:
     - Blog: `blog_<slug>`
     - Loja: `store_<slug>`
     - SaaS: `saas_<slug>`
     - Custom: `custom_<slug>`
3. **Credenciais e Segurança:**
   - `SUPABASE_SERVICE_ROLE_KEY` é de uso exclusivo de backend/serviço e **jamais** deve ser exposta no código cliente/frontend.
   - Toda personalização de tabelas e índices deve ocorrer única e exclusivamente dentro do `schema_name` do projeto.

---

## 2. Configuração de Acesso (Hermes / Agentes)

Para que o agente converse com o Control Tower, configure as seguintes variáveis no ambiente do agente:

```env
CONTROL_TOWER_BASE_URL=http://localhost:3000
CONTROL_TOWER_AGENT_API_KEY=ct_agent_live_9f8d2e4a7c1b50638e12d4a982e0b73c
```

Em todas as requisições HTTP, inclua o cabeçalho:
```http
Authorization: Bearer ct_agent_live_9f8d2e4a7c1b50638e12d4a982e0b73c
```
*(ou utilize o cabeçalho alternativo `x-api-key: <CONTROL_TOWER_AGENT_API_KEY>`)*.

---

## 3. Guia de Procedimentos

### Procedimento A: Consultar o Portfólio de Projetos
**Objetivo:** Obter a lista completa de bancos provisionados, schemas, domínios e status.

- **Requisição:** `GET /api/control-tower/projects`
- **Exemplo em cURL:**
  ```bash
  curl -s -H "Authorization: Bearer $CONTROL_TOWER_AGENT_API_KEY" \
    "$CONTROL_TOWER_BASE_URL/api/control-tower/projects"
  ```
- **Campos retornados por projeto:**
  - `id`: UUID do projeto no catálogo.
  - `name`: Nome amigável (ex: "Facebrasil").
  - `slug`: Identificador único (ex: "facebrasilblog").
  - `business_type`: `'blog' | 'store' | 'saas' | 'custom'`.
  - `schema_name`: Nome do schema isolado (ex: `blog_facebrasilblog`).
  - `domain`: Domínio de produção configurado.
  - `status`: `'active' | 'archived' | 'error'`.
  - `created_at`: Data e hora de criação.

---

### Procedimento B: Provisionamento de Novo Banco de Dados
**Objetivo:** Criar um novo projeto no catálogo e gerar automaticamente o schema com as tabelas do template solicitado.

- **Requisição:** `POST /api/control-tower/projects`
- **Headers:**
  - `Authorization: Bearer $CONTROL_TOWER_AGENT_API_KEY`
  - `Content-Type: application/json`
- **Regras de Payload:**
  - `name` (string, obrigatório): Nome legível do projeto.
  - `slug` (string, obrigatório): Apenas letras minúsculas, números e `_` (regex: `^[a-z0-9_]+$`).
  - `business_type` (string, obrigatório): `'blog' | 'store' | 'saas' | 'custom'`.
  - `template_key` (string, obrigatório):
    - Se `blog` $\rightarrow$ `blog_standard`
    - Se `store` $\rightarrow$ `store_standard`
    - Se `saas` $\rightarrow$ `saas_standard`
    - Se `custom` $\rightarrow$ `custom_base`
  - `domain` (string, opcional): Domínio oficial da aplicação (ex: `exemplo.com`).
  - `language` (string, opcional): `'pt' | 'en' | 'es'` (padrão: `'pt'`).
  - `organization_slug` (string, opcional): Padrão `'gestaodb'`.

- **Exemplo de Payload (Novo Blog):**
  ```json
  {
    "name": "Portal Tech News",
    "slug": "portaltechnews",
    "business_type": "blog",
    "template_key": "blog_standard",
    "domain": "portaltechnews.com",
    "language": "pt"
  }
  ```

- **Validação de Sucesso:**
  - Resposta HTTP `201 Created` contendo `{"message": "Projeto provisionado com sucesso", "project_id": "<uuid>"}`.

---

### Procedimento C: Geração de Documentos de Handoff
**Objetivo:** Extrair automaticamente as documentações prontas para consumo de outros agentes, squads ou deploys no Easypanel.

O Control Tower expõe 3 formatos de handoff para cada projeto:

1. **Documentação do Desenvolvedor (Developer Doc):**
   - **Endpoint:** `GET /api/control-tower/projects/[slug]/developer-doc`
   - **Finalidade:** Arquitetura do banco, lista de tabelas do schema, variáveis de ambiente completas (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_NAME`, etc.), regras de segurança e checklist de integração.

2. **Handoff para BigWriter:**
   - **Endpoint:** `GET /api/control-tower/projects/[slug]/bigwriter-handoff`
   - **Finalidade:** Contexto e variáveis para o agente editorial/redator de artigos (BigWriter), incluindo mapeamento das tabelas `articles`, `categories`, `authors`, `tags` e `media_assets`.

3. **Handoff para Frontend & AdSense:**
   - **Endpoint:** `GET /api/control-tower/projects/[slug]/frontend-adsense-handoff`
   - **Finalidade:** Configurações de layout, temas, slots de anúncios AdSense, metas de SEO e rotas públicas.

- **Exemplo de chamada:**
  ```bash
  curl -s -H "Authorization: Bearer $CONTROL_TOWER_AGENT_API_KEY" \
    "$CONTROL_TOWER_BASE_URL/api/control-tower/projects/portaltechnews/developer-doc" \
    -o "portaltechnews-dev-doc.md"
  ```

---

### Procedimento D: Executar Customizações SQL no Schema do Projeto
**Objetivo:** Adicionar tabelas personalizadas, colunas, índices ou views específicas sem alterar outros bancos.

- **Requisição:** `POST /api/control-tower/projects/[slug]/sql`
- **Payload:**
  ```json
  {
    "sql": "ALTER TABLE articles ADD COLUMN IF NOT EXISTS sponsor_name text;"
  }
  ```
- **Nota de Segurança:** O Control Tower automaticamente direciona o `search_path` para o schema do projeto correspondente.

---

### Procedimento E: Gestão de Ciclo de Vida e Exclusão
**Objetivo:** Manter o portfólio limpo, recriar schemas corrompidos ou remover projetos descontinuados.

1. **Rebuild de Schema:**
   - **Requisição:** `POST /api/control-tower/projects/[slug]/actions`
   - **Payload:** `{"action": "rebuild"}`
   - **Efeito:** Reexecuta a migração base do template no schema do projeto sem recriar o registro central.

2. **Arquivar Projeto:**
   - **Requisição:** `POST /api/control-tower/projects/[slug]/actions`
   - **Payload:** `{"action": "archive"}`
   - **Efeito:** Marca o projeto como inativo no catálogo (`status = 'archived'`).

3. **Excluir Projeto e Banco (`CASCADE`):**
   - **Requisição:** `DELETE /api/control-tower/projects/[slug]`
   - **Efeito:** Remove o schema dedicado (`DROP SCHEMA ... CASCADE`), deleta o registro na tabela `projects` e grava o evento em `audit_logs`.
   - **Atenção:** Ação destrutiva. O agente só deve executar após confirmação explícita do operador.

---

## 4. Checklist de Operação do Agente

Ao receber uma ordem de provisionamento ou gestão, o agente deve:
- [ ] Verificar se o `slug` atende ao padrão minúsculo sem espaços nem caracteres especiais.
- [ ] Confirmar se o `template_key` corresponde ao `business_type`.
- [ ] Realizar o `POST /api/control-tower/projects`.
- [ ] Após o provisionamento, chamar `GET .../developer-doc` para obter as credenciais e variáveis geradas.
- [ ] Reportar ao usuário o sucesso com o `schema_name` criado e as variáveis prontas para a equipe ou serviço.
