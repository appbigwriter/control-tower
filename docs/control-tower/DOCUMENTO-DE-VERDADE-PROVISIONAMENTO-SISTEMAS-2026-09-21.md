# Documento de Verdade — Provisionamento de Sistemas

**Projeto:** GestaoDB / Control Tower  
**Versão:** 1.0.0  
**Status:** referência operacional  
**Escopo:** Sistemas, Blogs, SaaS e Stores

## 1. Regra central

O Control Tower é a fonte de catálogo, identidade, schema, contrato de runtime, secrets por referência, readback e estado de provisionamento.

O Easypanel é o runtime de execução.

O Supabase central é a fonte relacional compartilhada; cada projeto usa um schema próprio no database `postgres`.

Nenhum projeto é considerado concluído sem readback real de Environment, deploy, health e persistência.

## 2. Topologia de hosting

| Opção do formulário | Target | Projeto Easypanel |
|---|---|---|
| sistemas — VPS2 | vps2 | sistemas |
| blogs — VPS2 | vps2 | blogs |
| projetos — VPS1 | vps1 | projetos |

O `repository_path` padrão é:

```text
/09-codigo
```

O path do repositório não é o path público do domínio. O domínio normalmente usa `/`.

## 3. Fluxo canônico de provisionamento

### Etapa 1 — Cadastrar o projeto

Registrar no Control Tower:

```text
name
slug
business_type
template_key
schema_name
domain
repository_url
repository_path
hosting_target
hosting_project_name
service_name
language
status=pending
```

O `project_id` é gerado pelo catálogo e permanece imutável.

### Etapa 2 — Validar identidade

Antes de qualquer schema, Environment ou deploy:

```text
slug único
schema válido e exclusivo
business_type compatível com template_key
hosting_project_name compatível com hosting_target
repository_path presente
service_name válido
```

Para o Authority:

```text
slug=authorityengine
business_type=custom
template_key=custom_base
schema_name=custom_authorityengine
```

### Etapa 3 — Criar ou confirmar serviço Easypanel

O serviço deve existir no projeto Easypanel selecionado e ter readback confirmado:

```text
repository_url
branch/ref
repository_path
service_name
domain
porta interna
```

O fluxo não deve criar um serviço vazio silenciosamente como substituto de configuração.

### Etapa 4 — Gerar runtime contract

O Control Tower gera server-side:

```text
project_id
schema_name
namespace
repository_path
service_name
AUTHORITY_OWNER_ID, quando aplicável
```

### Etapa 5 — Resolver Environment real

Valores derivados são gerados pelo catálogo.

Valores compartilhados vêm do Supabase central.

Secrets são resolvidos server-side e nunca aparecem em chat, frontend, documentação pública, receipt ou Git.

A `DATABASE_URL` deve ser uma DSN real e acessível pelo container:

```text
postgresql://postgres.<POOLER_TENANT_ID>:<POSTGRES_PASSWORD>@<endpoint>:<port>/postgres
```

Para a infraestrutura validada:

```text
tenant=supabase-vps2
host=76.13.168.223
port=15432
database=postgres
```

### Etapa 6 — Injetar Environment

Enviar os valores reais para o Environment do serviço Easypanel.

Bloquear a operação se houver:

```text
<SUPABASE_
<GENERATED_
<secret-manager:
your-tenant-id
PLACEHOLDER
```

### Etapa 7 — Readback do Environment

Confirmar sem expor valores:

```text
variável presente
valor não-placeholder
DATABASE_URL com host/porta/database corretos
schema e project_id coerentes
```

### Etapa 8 — Provisionar schema

Criar o schema específico no database `postgres` e confirmar sua existência.

Nunca usar schema de outro projeto.

### Etapa 9 — Deploy

Executar deploy somente depois do Environment e schema confirmados.

### Etapa 10 — Health e persistência

Validar:

```text
HTTP 200 em /health
processo ativo
porta interna respondendo
persistence relational-postgres
write/readback de registro sintético
restart e novo readback
```

## 4. Contrato base de Environment

Variáveis comuns:

```env
NODE_ENV=production
APP_ENV=production
CONTROL_TOWER_BASE_URL=https://control-tower.fbr.news
CONTROL_TOWER_PROJECT_ID=<PROJECT_ID_REAL>
CONTROL_TOWER_SCHEMA_NAME=<SCHEMA_REAL>
DATABASE_URL=<DSN_REAL_RESOLVIDA_SERVER_SIDE>
SUPABASE_URL=https://supabase-control-tower-api.fbr.news
SUPABASE_ANON_KEY=<VALOR_REAL_QUANDO_APLICÁVEL>
SUPABASE_SERVICE_ROLE_KEY=<VALOR_REAL_RESOLVIDO_SERVER_SIDE>
PORT=3400
HOST=0.0.0.0
```

O documento é sanitizado; o Environment do Easypanel recebe os valores reais.

## 5. Estrutura validada para Systems/Authority

```text
cadastro:
  slug=authorityengine
  business_type=custom
  template_key=custom_base
  schema=custom_authorityengine
  target=vps2
  easypanel_project=sistemas
  service=authority
  repository_path=/09-codigo
  port=3400

runtime adicional:
  AUTHORITY_PROJECT_ID=<PROJECT_ID_REAL>
  AUTHORITY_OWNER_ID=<UUID_ESTÁVEL>
  AUTHORITY_ADMIN_TOKEN=<TOKEN_REAL>
  AUTHORITY_OPERATOR_TOKEN=<TOKEN_REAL>
  AUTHORITY_REVIEWER_TOKEN=<TOKEN_REAL>
  AUTHORITY_PUBLISHER_TOKEN=<TOKEN_REAL>
  AUTHORITY_VIEWER_TOKEN=<TOKEN_REAL>
```

## 6. Adaptações por tipo de projeto

### Blogs

Alterar:

```text
business_type=blog
template_key=blog_standard
schema_name=custom_<slug_ou_identidade>
namespace=fbr/blogs/<project_id>
```

Manter:

```text
repository_path=/09-codigo
DATABASE_URL para database postgres
schema exclusivo
hosting target selecionado no formulário
health/readback
```

Adicionar ou validar, conforme o runtime:

```text
site identity
editorial configuration
authors
categories
articles
media
SEO
```

Não usar tokens do Authority como contrato obrigatório do Blog; a identidade editorial vem do Authority por integração controlada.

### SaaS

Alterar:

```text
business_type=saas
template_key=saas_standard
schema_name=custom_<slug_ou_identidade>
namespace=fbr/saas/<project_id>
```

Adicionar ou validar:

```text
organizations
workspaces
workspace_members
plans
subscriptions
billing
usage_events
feature_flags
api_keys
```

Requer validação adicional de isolamento entre organizações e cobrança antes de produção.

### Stores

Alterar:

```text
business_type=store
template_key=store_standard
schema_name=custom_<slug_ou_identidade>
namespace=fbr/store/<project_id>
```

Adicionar ou validar:

```text
products
categories
variants
inventory
customers
orders
order_items
```

Requer validação adicional de estoque, pedidos, pagamentos e webhooks antes de produção.

## 7. O que não muda entre os tipos

```text
Control Tower como catálogo
project_id imutável
schema separado por projeto
database postgres central
repository_path padrão /09-codigo
hosting options do formulário
Environment real injetado server-side
readback obrigatório
health obrigatório
secrets fora de frontend/log/documentação pública
```

## 8. Gates de conclusão

Um projeto só pode avançar para o próximo quando:

```text
[ ] cadastro lido de volta
[ ] identidade validada
[ ] serviço Easypanel lido de volta
[ ] repository_path confirmado
[ ] Environment real lido de volta
[ ] schema criado e confirmado
[ ] deploy confirmado
[ ] health HTTP 200
[ ] persistência write/readback confirmada
[ ] receipt sanitizado registrado
```

## 9. Ordem do portfólio

```text
1. Authority Engine
2. Blogs
3. SaaS
4. Stores
5. Agency Flux e integrações dependentes
```

Nenhum projeto posterior deve ser provisionado enquanto o projeto anterior não cumprir todos os gates.
