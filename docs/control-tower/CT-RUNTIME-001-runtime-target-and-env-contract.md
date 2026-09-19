# CT-RUNTIME-001 — Contrato de alvo de runtime e geração segura de ambiente

**Status:** proposta implementável — revisão/Gate de Sergio pendentes  
**Projeto:** GestaoDB / Control Tower / Authority Engine / FBR Agency Flux  
**Data:** 2026-09-19

## 1. Problema que este contrato resolve

O provisionamento atual cria schema, namespace e alguns artefatos, mas não informa de forma verificável **onde** o runtime do projeto está, **quem** pode escrever a configuração e **quais** variáveis completas são necessárias. Isso produz gaps como `DATABASE_URL` ausente no Authority.

## 2. Princípio

O projeto é identificado por `project_id`; a pasta é um alvo de execução, não a identidade do projeto. O Control Tower deve gerar um contrato por projeto e ambiente contendo:

- projeto e schema lidos do catálogo;
- ambiente (`development`, `staging`, `production`);
- `project_root` e `execution_dir`, quando o alvo for local;
- serviço/runtime remoto, quando o alvo for deploy;
- executor autorizado;
- inventário completo de variáveis;
- origem de cada valor (`derived`, `secret_manager`, `provider`, `operator_input`);
- referência segura, nunca o secret;
- política de escrita;
- estado de validação e readback.

## 3. Alvos suportados

### 3.1 Desenvolvimento local

Exemplo sanitizado:

```json
{
  "project_id": "<uuid>",
  "environment": "development",
  "target_type": "local_filesystem",
  "project_root": "F:/Projetos/_FBR/AuthorityEngine",
  "execution_dir": "F:/Projetos/_FBR/AuthorityEngine/09-codigo",
  "env_file": "F:/Projetos/_FBR/AuthorityEngine/09-codigo/.env.local",
  "executor": "hermes-local-runner",
  "write_policy": "generate_local_env_only",
  "secret_namespace": "secret-manager:fbr/authority/<uuid>/development/",
  "status": "target_registered"
}
```

Regras:

- o Control Tower persiste somente o alvo e a referência;
- um runner local autorizado resolve os secrets e grava `.env.local`;
- o arquivo deve estar no `.gitignore` e nunca ser enviado ao chat, Git, frontend ou receipt;
- o runner valida a lista de variáveis, permissões do arquivo e health/readback;
- o Control Tower recebe apenas receipt sanitizado e presença/status das variáveis.

### 3.2 Staging/produção

```json
{
  "project_id": "<uuid>",
  "environment": "production",
  "target_type": "easypanel_service",
  "service_name": "<derived-from-project-id>",
  "executor": "control-tower-provider-adapter",
  "secret_namespace": "secret-manager:fbr/authority/<uuid>/production/",
  "write_policy": "provider_runtime_injection",
  "status": "target_registered"
}
```

Não há escrita em pasta Windows local. O adapter injeta no serviço autorizado e confirma configuração, deploy/health e readback.

## 4. Inventário completo do Authority

O template do Authority deve declarar pelo menos:

### Derivadas/não secretas

```text
PORT
HOST
AUTHORITY_PROJECT_ID
AUTHORITY_OWNER_ID
CONTROL_TOWER_PROJECT_ID
CONTROL_TOWER_SCHEMA_NAME
CONTROL_TOWER_BASE_URL
SUPABASE_URL
```

### Secrets server-side

```text
DATABASE_URL
SUPABASE_SERVICE_ROLE_KEY
AUTHORITY_ADMIN_TOKEN
AUTHORITY_OPERATOR_TOKEN
AUTHORITY_REVIEWER_TOKEN
AUTHORITY_PUBLISHER_TOKEN
AUTHORITY_VIEWER_TOKEN
```

### Integrações opcionais, mas explicitamente classificadas

```text
AMAZON_API_URL
AMAZON_API_KEY
SECONDARY_MARKETPLACE_API_URL
SECONDARY_MARKETPLACE_API_KEY
IMAGE_PROVIDER_API_URL
IMAGE_PROVIDER_API_KEY
PUBLISHING_PROVIDER_API_URL
PUBLISHING_PROVIDER_API_KEY
```

Cada variável deve ter `required`, `secret`, `source`, `reference_path`, `consumer`, `environment` e `validation_rule`. Variável opcional não pode simplesmente desaparecer: deve aparecer como `optional_unconfigured`.

## 5. Estados

```text
discovered
→ target_registered
→ inventory_generated
→ references_bound
→ injected
→ health_verified
→ readback_verified
→ runtime_ready
```

Falhas obrigam estados explícitos:

```text
blocked_missing_reference
provider_failed
health_failed
readback_failed
scope_mismatch
```

Nunca marcar `runtime_ready` por build, HTTP 200 isolado ou geração de arquivo local.

## 6. Readback obrigatório

O readback não retorna valores secretos. Ele confirma:

- `project_id`;
- `environment`;
- target/service;
- schema esperado;
- nomes de variáveis presentes;
- referências/versões;
- ausência de variáveis obrigatórias;
- health do runtime;
- tipo de persistência (`relational-postgres`);
- versão/commit servido;
- timestamp e correlation ID.

## 7. Segurança

- `project_root` é metadata de alvo, não autorização universal de escrita;
- o runner deve aceitar somente diretórios registrados e aprovados;
- caminhos fora do workspace permitido devem bloquear;
- secrets nunca entram em payloads de configuração, downloads, logs, Git ou receipts;
- qualquer gravação local exige `write_policy=generate_local_env_only` e ambiente `development`;
- produção exige Secret Manager/provider;
- rotação cria nova versão, valida health/readback e só depois revoga a anterior.

## 8. Aceite

A solução só está pronta quando, para um projeto de teste:

1. o Control Tower lê `project_id`, schema e ambiente;
2. registra o target correto;
3. gera o inventário completo;
4. cria/valida referências no namespace;
5. um executor autorizado injeta ou grava no alvo correto;
6. o runtime inicia sem JSON local;
7. health confirma banco relacional;
8. escrita real e readback passam;
9. restart mantém o estado;
10. readback pós-restart passa;
11. o receipt não contém secrets;
12. outro projeto não consegue ler o namespace nem o alvo.

## 10. Decisão conservadora de implementação

A primeira versão não terá runner local nem escrita automática em pastas do projeto. O Control Tower será a fonte de geração e registro:

1. deriva o inventário completo de variáveis a partir do projeto, template, schema e ambiente;
2. gera referências seguras para os secrets;
3. registra o contrato e os metadados no banco do Control Tower;
4. gera o **Developer Document** completo, com nomes, referências, caminhos, ambiente, schema, instruções e checklist;
5. entrega ao Dev o documento para configuração no ambiente correto;
6. registra o status como `generated`, `registered`, `delivered` ou `verified`, sem declarar runtime pronto por inferência.

O Control Tower **não** grava `.env` diretamente no repositório, na pasta local ou na VPS nesta primeira versão. Também não persiste valores de secrets no banco de catálogo, no Developer Document, no frontend, no Git ou nos receipts.

O Developer Document deve conter:

- `project_id`;
- `environment`;
- `schema_name`;
- `service_name` esperado;
- inventário completo de variáveis;
- classificação `public`, `runtime_private` ou `optional`;
- `required`/`optional`;
- origem (`derived`, `secret_manager`, `provider`, `operator_input`);
- `secret_ref`, quando privado;
- valores derivados não sensíveis;
- instruções para local, VPS e provider;
- checklist de conexão, schema, RLS, ownership, escrita e readback;
- versão do contrato e timestamp.

A automação de injeção em Easypanel/VPS e qualquer runner local ficam fora desta primeira entrega e só entram mediante novo Gate específico.