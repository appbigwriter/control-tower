# F0-STRUCT-002 + F0-SEC-003 — Control Tower local contract v1.0.0

Este documento é a contraparte GestaoDB do contrato completo em `F:/Projetos/_FBR/FBR Agency Flux/08-historico/F0-STRUCT-002-F0-SEC-003-MIGRATION-AUTH-CONTRACT-v1.0.0.md`.

## FACT — estado observado

- Há colisão de basenames: `010_complete_schema_provisioning.sql` e `010_service_identity_and_secrets.sql`; `011_flux_external_state.sql` e `011_project_configuration_artifacts.sql`.
- CT-001 usa `projects` + `project_configuration_artifacts`, depende de `control_tower_final_schema.sql` e de `update_updated_at_column()`.
- CT-001 POST/GET usa `createServiceRoleClient()` e não exige scope específico na rota; o middleware aceita admin session ou qualquer principal aceito por `isValidAgentApiKey`.
- `project_configuration_artifacts` não tem RLS/policies no arquivo 011B.
- `control_tower_final_schema.sql` tem `is_admin()` que retorna `true`; migration 006 expõe SELECT autenticado com `using(true)` para projects/templates.
- `010_service_identity_and_secrets.sql` depende de `projects` e `update_updated_at_column()`.
- `011_flux_external_state.sql` cria `flux_state`; é pré-requisito de `FBR Agency Flux/04-database/002_flux_state_version_cas.sql`.

## DECISION — IDs canônicos propostos

O runner futuro deve registrar IDs únicos, sem confiar em basename:

```text
CT-000 CT-BASE                 control_tower_final_schema.sql
CT-006 CT-RLS-READ             006_control_tower_public_read.sql
CT-007 CT-CORE-RECONCILE       007_control_tower_reconcile_core_columns.sql
CT-008 CT-STATS                008_control_tower_stats_rpc.sql
CT-009 CT-SQL-EXEC             009_control_tower_project_sql_exec.sql
CT-010A CT-PROVISION            010_complete_schema_provisioning.sql
CT-010B CT-IDENTITY-SECRETS     010_service_identity_and_secrets.sql
CT-011A CT-FLUX-STATE           011_flux_external_state.sql
CT-011B CT-CONFIG-ARTIFACTS     011_project_configuration_artifacts.sql
```

Ordem: `CT-000 → CT-006/007/008 → CT-009 → CT-010A → CT-010B → CT-011A/CT-011B`. CT-011A e CT-011B são independentes entre si após CT-000, mas CT-011B exige `projects` e a function de timestamp.

Fluxo dependente: `CT-000 → CT-011A → FLUX-002`; para Flux relacional: `CT-000 → FLUX-003 → FLUX-004-RPC`. O arquivo Flux `004_flux_runtime_relational.sql` fica quarantined por duplicar o 004-RPC e aplicar FORCE RLS.

## DECISION — CT-001 authorization contract

- Actor efetivo: sessão/JWT validado server-side, nunca body/query.
- GET exige `ct:projects:read` e tenant/organization do projeto.
- POST exige `ct:configuration:write`, projeto dentro da organização do principal, artifact type allowlisted e idempotência `(project_id, artifact_type)`.
- `created_by` deve ser actor/identity derivado, não literal `admin-panel`.
- `ct:sql:execute` não é necessário para CT-001; nunca concedê-lo por ser admin de configuração.
- Service role só fica no servidor e secrets nunca entram em payload/arquivo/download/log.

## RBAC/scopes mínimos

| Principal | Scopes | CT-001 |
|---|---|---|
| Sergio/admin | `ct:projects:read`, `ct:configuration:write` | GET/POST em org permitida |
| Flux service | `ct:projects:read`, `ct:configuration:write` via evento assinado/idempotente | somente projeto recebido e validado |
| Auditor | `ct:projects:read` | GET/readback, sem mutação |
| Agent genérico | nenhum por padrão | 401/403 |
| SQL operator | `ct:sql:execute` separado + Gate explícito | não autorizado em CT-001 |

## RLS/tenant contract

- `projects.organization_id` é o tenant Control Tower atual; artefatos herdam o tenant por `project_id`.
- Policy de artefatos deve usar `exists (select 1 from projects p where p.id = project_configuration_artifacts.project_id and p.organization_id = app.organization_id())` (função/claim ainda precisa ser definida e aprovada).
- Sem tenant/org context: fail closed.
- `service_role` é exceção server-side controlada; a API ainda precisa fazer autorização de principal antes de usar o client service-role.
- `organizations`, `projects`, `provisioning_jobs`, `audit_logs`, `service_identities`, `secret_namespaces`, `secret_bindings` e `project_configuration_artifacts` precisam de matriz RLS revisada antes de Gate remoto.

## Negative tests locais obrigatórios

1. POST CT-001 sem sessão → 401.
2. POST com sessão read-only → 403.
3. POST com token agent sem `ct:configuration:write` → 403.
4. POST com projeto inexistente/outro organization → 404/403 sem vazamento.
5. POST type inválido/domínio ausente → 400 sem upsert.
6. GET outro tenant → 403/zero rows.
7. POST repetido → um registro por `(project_id, artifact_type)`.
8. Artefato gerado não contém `SUPABASE_SERVICE_ROLE_KEY` com valor, tokens ou secrets.
9. Token expirado/revogado/suspenso → 401.
10. `CONTROL_TOWER_ADMIN_SECRET` ausente não pode cair em `default-secret-change-me`.
11. `is_admin()` não pode autorizar toda linha por retorno literal `true`.
12. `ct:sql:execute` sem Gate → 403 e nenhum SQL executado.

Os testes devem ser fixtures/mocks locais e não chamar Supabase, Easypanel, DNS ou rede.

## Rollback/readback plan

- Gate antes de qualquer aplicação; snapshot e catálogo pré-migration.
- Aplicar CT-011B somente após confirmar CT-000 e `update_updated_at_column()`.
- Rollback de CT-011B: preservar rows; remover/reverter somente após dependents e backup. Não apagar artifacts como rollback automático.
- Readback: `to_regclass('public.project_configuration_artifacts')`, colunas/unique/FK/trigger, RLS/policies, owner/function security, contagem por project/type; depois POST/GET autorizado e confirmação de payload sem secrets.
- Falha remota mantém estado `blocked`, último readback confirmado e erro sanitizado. Não declarar CT-001 publicado com testes locais apenas.

## RECOMMENDATION

Criar registry de migrations com `migration_id`, `source_path`, `checksum`, `requires`, `applied_at`, `rollback_ref` e `readback_ref`. Separar `CT-011A` e `CT-011B` no registry mesmo que os arquivos atuais permaneçam imutáveis.

## BLOCKER

Não há prova local de que CT-011B foi aplicada remotamente nem de que policies/owners/RLS atuais correspondem ao contrato. Aplicação SQL, POST/GET real, rotação de secrets e readback dependem de Sergio/owner Supabase e Gate remoto. Este artifact não executa nada remoto.

## Evidence paths

- `F:/Projetos/_FBR/GestaoDB/supabase/migrations/control_tower_final_schema.sql`
- `F:/Projetos/_FBR/GestaoDB/supabase/migrations/006_control_tower_public_read.sql`
- `F:/Projetos/_FBR/GestaoDB/supabase/migrations/010_complete_schema_provisioning.sql`
- `F:/Projetos/_FBR/GestaoDB/supabase/migrations/010_service_identity_and_secrets.sql`
- `F:/Projetos/_FBR/GestaoDB/supabase/migrations/011_flux_external_state.sql`
- `F:/Projetos/_FBR/GestaoDB/supabase/migrations/011_project_configuration_artifacts.sql`
- `F:/Projetos/_FBR/GestaoDB/src/app/api/control-tower/projects/[slug]/configuration/route.ts`
- `F:/Projetos/_FBR/GestaoDB/src/lib/auth/control-tower.ts`
- `F:/Projetos/_FBR/GestaoDB/src/middleware.ts`
- `F:/Projetos/_FBR/GestaoDB/docs/control-tower/CT-001-project-configuration-artifacts.md`
- Global approved flow: `F:/Projetos/_FBR/AuthorityEngine/02-prd/GLOBAL-FLOW-AUTHORITY-BLOGS-FLUX-CONTROL-TOWER.md`
