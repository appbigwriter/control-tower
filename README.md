# GestaoDB | Control Tower

[![Next.js](https://img.shields.io/badge/Next.js-15.5-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-blue?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=flat-square&logo=supabase)](https://supabase.com/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.4-38B2AC?style=flat-square&logo=tailwind-css)](https://tailwindcss.com/)
[![Easypanel](https://img.shields.io/badge/Easypanel-REST_2.34-0070F3?style=flat-square)](https://easypanel.io/)

**Central de Governança, Catálogo e Provisionamento Multi-Tenant de Bancos de Dados PostgreSQL / Supabase do Ecossistema FBR.**

---

## 📌 Sumário

- [Visão Geral](#-visão-geral)
- [Princípios de Arquitetura](#-princípios-de-arquitetura)
- [Templates de Schemas Suportados](#-templates-de-schemas-suportados)
- [Segurança & Zero Secret Leaks](#-segurança--zero-secret-leaks)
- [Módulos e Handoffs de Integração](#-módulos-e-handoffs-de-integração)
- [Endpoints da API REST](#-endpoints-da-api-rest)
- [Integração com Easypanel](#-integração-com-easypanel)
- [Stack Tecnológica](#-stack-tecnológica)
- [Estrutura do Repositório](#-estrutura-do-repositório)
- [Instalação e Execução](#-instalação-e-execução)
- [Testes e Gates de Qualidade](#-testes-e-gates-de-qualidade)
- [Skill do Agente Antigravity / Hermes](#-skill-do-agente-antigravity--hermes)

---

## 🎯 Visão Geral

O **GestaoDB / Control Tower** atua como o cérebro central para provisionamento automatizado, orquestração e monitoramento de bancos de dados para todos os projetos da holding (Blogs, E-commerces, SaaS e Projetos Customizados).

Ele centraliza:
- **Catálogo Unificado:** Registro oficial de todas as instâncias, domínios, schemas, status e organizações.
- **Provisionamento On-Demand:** Criação instantânea de schemas PostgreSQL isolados a partir de templates SQL versionados.
- **Geração Automática de Handoffs:** Emissão de especificações prontas para consumo por squads e agentes autônomos (Developer Doc, BigWriter e Frontend/AdSense).
- **Orquestração de Infraestrutura:** Criação de serviços e injeção segura de variáveis no Easypanel via REST API oficial.

```
                    ┌─────────────────────────┐
                    │     AGENTE / OPERADOR   │
                    │   (Hermes/Antigravity)  │
                    └────────────┬────────────┘
                                 │ HTTP API / Skills
                                 ▼
                    ┌─────────────────────────┐
                    │  GESTAODB CONTROL TOWER │
                    │    (Next.js 15 Engine)  │
                    └──────┬────────────┬─────┘
                           │            │
         Provisionamento   │            │ Injeção de Runtime & Deploy
        & Governança Schema│            │ (REST API 2.34.0)
                           ▼            ▼
             ┌─────────────────┐    ┌─────────────────┐
             │    SUPABASE     │    │    EASYPANEL    │
             │   (PostgreSQL)  │    │   (VPS Docker)  │
             │                 │    │                 │
             │ ├─ public       │    │ ├─ Blog Serv.   │
             │ ├─ blog_slug1   │    │ ├─ Store Serv.  │
             │ ├─ store_slug2  │    │ └─ SaaS Serv.   │
             │ └─ saas_slug3   │    │                 │
             └─────────────────┘    └─────────────────┘
```

---

## 🏛️ Princípios de Arquitetura

1. **Catálogo Central (`public`):**
   - As tabelas centrais (`projects`, `organizations`, `provisioning_jobs`, `audit_logs`) pertencem exclusivamente à governança central do Control Tower.
   - **Regra inegociável:** Aplicações clientes e squads externos **NUNCA** devem alterar, criar ou remover tabelas do schema `public`.

2. **Multi-Tenancy por Schema Dedicado:**
   - Cada projeto possui isolamento lógico em seu próprio schema PostgreSQL dentro do cluster:
     - **Blogs:** `blog_<slug>` (ex: `blog_facebrasil`)
     - **Lojas Virtuais:** `store_<slug>` (ex: `store_dropship`)
     - **SaaS:** `saas_<slug>` (ex: `saas_crm`)
     - **Custom:** `custom_<slug>`

3. **Isolamento de Search Path:**
   - Consultas, migrações e comandos SQL executados para uma entidade são restritos automaticamente ao schema do respectivo projeto via `SET search_path TO <schema_name>`.

---

## 📦 Templates de Schemas Suportados

| Template Key | Tipo de Negócio | Principais Tabelas Inclusas |
| :--- | :--- | :--- |
| `blog_standard` | Blog / Portal Editorial | `articles`, `categories`, `authors`, `tags`, `article_tags`, `media_assets`, `settings` |
| `store_standard` | E-commerce / Loja | `products`, `categories`, `orders`, `order_items`, `customers`, `inventory`, `coupons` |
| `saas_standard` | Plataforma SaaS / Assinaturas | `organizations`, `workspaces`, `workspace_members`, `plans`, `subscriptions`, `invoices`, `feature_flags`, `api_keys` |
| `custom_base` | Customizado / Específico | Estrutura base de auditoria e configurações, expansível via Editor SQL |

---

## 🔒 Segurança & Zero Secret Leaks

O ecossistema implementa o padrão **Zero Secret Leaks**:

- **Nenhum Segredo Comitado:** Chaves mestras (`SUPABASE_SERVICE_ROLE_KEY`, tokens de API privados) nunca são incluídas em repositórios Git, logs públicos ou prompts de IA.
- **Namespace Imutável:** Cada projeto recebe um namespace seguro para referenciar seus segredos no Secret Manager:
  ```text
  fbr/blogs/<PROJECT_ID>/
  fbr/projects/<PROJECT_ID>/
  ```
- **Separação Rigorosa de Variáveis:**
  - **Públicas (`NEXT_PUBLIC_*`):** Acessíveis no browser/frontend (ex: `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_SUPABASE_URL`).
  - **Privadas (Runtime):** Injetadas exclusivamente na aba **Environment** do Easypanel / Docker runtime no servidor (ex: `SUPABASE_SERVICE_ROLE_KEY`).

---

## 📑 Módulos e Handoffs de Integração

O Control Tower gera automaticamente 3 documentos padronizados para cada projeto provisionado:

1. **Developer Doc (`/developer-doc`):**
   - Especificação técnica completa de arquitetura, tabelas do schema, checklist de segurança e `.env.example` estruturado com referências de namespace.
2. **BigWriter Handoff (`/bigwriter-handoff`):**
   - Configurações e mapeamento de campos necessários para o agente de geração editorial e automação de conteúdo (BigWriter).
3. **Frontend & AdSense Handoff (`/frontend-adsense-handoff`):**
   - Identidade visual, slots de publicidade Google AdSense, diretrizes de SEO, slugs e temas.

---

## 🌐 Endpoints da API REST

A API do Control Tower é protegida via header `Authorization: Bearer <CONTROL_TOWER_AGENT_API_KEY>` ou `x-api-key`.

### 1. Projetos & Governança

- **Listar Projetos:**
  ```http
  GET /api/control-tower/projects
  ```
- **Provisionar Novo Banco / Projeto:**
  ```http
  POST /api/control-tower/projects
  Content-Type: application/json

  {
    "name": "Portal Tech News",
    "slug": "portaltechnews",
    "business_type": "blog",
    "template_key": "blog_standard",
    "domain": "portaltechnews.com",
    "language": "pt"
  }
  ```
- **Consultar Detalhes do Projeto:**
  ```http
  GET /api/control-tower/projects/{slug}
  ```
- **Excluir Projeto e Schema (`CASCADE`):**
  ```http
  DELETE /api/control-tower/projects/{slug}
  ```

### 2. Documentação & Handoffs

- **Developer Doc:** `GET /api/control-tower/projects/{slug}/developer-doc`
- **BigWriter Handoff:** `GET /api/control-tower/projects/{slug}/bigwriter-handoff`
- **Frontend & AdSense:** `GET /api/control-tower/projects/{slug}/frontend-adsense-handoff`
- **Configuração JSON:** `GET /api/control-tower/projects/{slug}/configuration`

### 3. Ações & Customizações SQL

- **Executar SQL no Schema Isolado:**
  ```http
  POST /api/control-tower/projects/{slug}/sql
  Content-Type: application/json

  {
    "sql": "ALTER TABLE articles ADD COLUMN IF NOT EXISTS sponsor_name text;"
  }
  ```
- **Rebuild / Arquivamento:**
  ```http
  POST /api/control-tower/projects/{slug}/actions
  Content-Type: application/json

  {
    "action": "rebuild" | "archive"
  }
  ```

---

## ⚡ Integração com Easypanel

O Control Tower inclui um adapter nativo que dialoga diretamente com a **API REST oficial do Easypanel (v2.34.0)**:

- **Autenticação:** `Authorization: Bearer <EASYPANEL_API_TOKEN>`
- **Namespace e Service Naming:** Derivação dinâmica de serviços (ex: `fbr/gestaodb` $\rightarrow$ `gestaodb`).
- **Readback Obrigatório:** Após qualquer mutação (`createAppService`, `updateAppEnv`, `deployAppService`), o adapter inspeciona o estado real retornado pelo Easypanel (`inspectAppService`), evitando estados inventados e garantindo resiliência.

---

## 🛠️ Stack Tecnológica

- **Framework Web:** [Next.js 15](https://nextjs.org/) (App Router & Route Handlers)
- **UI & Reatividade:** [React 19](https://react.dev/) + [TailwindCSS 3.4](https://tailwindcss.com/)
- **Linguagem:** [TypeScript 5.8](https://www.typescriptlang.org/)
- **Banco de Dados & Storage:** [Supabase](https://supabase.com/) / PostgreSQL 15+
- **Validação de Schemas:** [Zod](https://zod.dev/)
- **Criptografia & JWT:** [jose](https://github.com/panva/jose)
- **Containerização:** Docker (Build `standalone` multi-stage)

---

## 📂 Estrutura do Repositório

```text
GestaoDB/
├── .agents/
│   └── skills/
│       └── gestaodb-control-tower/   # Skill oficial para agentes Antigravity/Hermes
├── docs/                             # Documentações de arquitetura, contratos e guias
│   ├── controltower-dev-doc.md
│   ├── easypanel-rest-contract.md
│   └── guia-de-variaveis-e-secrets-para-o-dev.md
├── scripts/                          # Scripts de homologação e contratos Easypanel
├── src/
│   ├── app/                          # Rotas Next.js App Router
│   │   ├── api/                      # Route Handlers REST (Control Tower & Auth)
│   │   ├── control-tower/            # Painel Web do Control Tower
│   │   ├── login/                    # Autenticação administrativa
│   │   ├── globals.css
│   │   └── page.tsx                  # Dashboard principal
│   ├── components/                   # Componentes de UI reutilizáveis
│   └── lib/                          # Lógica de negócio, clients e adapters
│       ├── auth/                     # Validação de tokens e senhas
│       ├── control-tower/            # Mapeamentos e regras de governança
│       ├── secrets/                  # Handlers de secrets IAM
│       └── supabase/                 # Client Supabase e executores SQL
├── supabase/                         # Migrações SQL centrais e templates de schemas
├── tests/                            # Testes unitários e de integração
├── Dockerfile                        # Configuração de container standalone
├── package.json
└── tsconfig.json
```

---

## 🚀 Instalação e Execução

### 1. Pré-requisitos
- Node.js 20+ ou 22+
- Docker (opcional, para execução em container)
- Instância Supabase PostgreSQL configurada

### 2. Configuração de Variáveis de Ambiente
Crie um arquivo `.env.local` na raiz do projeto baseado no `.env.example`:

```env
# Conexão Supabase Central
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key-privada

# Segredo de Autenticação do Control Tower
CONTROL_TOWER_ADMIN_SECRET=seu-segredo-de-admin-forte
NEXT_PUBLIC_APP_NAME=Control Tower

# Integração Easypanel (Opcional / Runtime)
EASYPANEL_API_URL=https://easypanel.seu-dominio.com/api
EASYPANEL_API_TOKEN=seu-token-easypanel
EASYPANEL_PROJECT_NAME=projetos
```

### 3. Executando Localmente

```bash
# Instalar dependências
npm install

# Iniciar servidor de desenvolvimento
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000) no seu navegador.

### 4. Build de Produção & Docker

```bash
# Build local
npm run build
npm run start

# Ou via Docker
docker build -t gestaodb-control-tower .
docker run -p 3000:3000 --env-file .env.local gestaodb-control-tower
```

---

## 🧪 Testes e Gates de Qualidade

Para garantir integridade de tipos, contratos e conformidade das rotas antes de deploys:

```bash
# Executar todos os testes automatizados
npm test

# Validação de tipos TypeScript
npm run typecheck

# Lint de código
npm run lint

# Validação de fixtures do contrato Easypanel
npm run contract:fixture
```

---

## 🤖 Skill do Agente Antigravity / Hermes

Este repositório inclui a skill de agente **`gestaodb-control-tower`** localizada em [`.agents/skills/gestaodb-control-tower/SKILL.md`](.agents/skills/gestaodb-control-tower/SKILL.md).

Ela permite que agentes autônomos realizem:
- Provisionamento automatizado de novos portais sem intervenção humana;
- Extração de `developer-doc.md` e `bigwriter-handoff.md`;
- Execução controlada de migrações e customizações de banco em schemas isolados;
- Auditoria de integridade do catálogo multi-tenant.

---

## 📜 Licença

Propriedade privada e confidencial — **FBR Holding / Agency Flux**. Todos os direitos reservados.
