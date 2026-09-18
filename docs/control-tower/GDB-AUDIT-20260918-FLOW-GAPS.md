# Auditoria GestaoDB contra o fluxo global

- **ID:** GDB-AUDIT-20260918-FLOW-GAPS
- **Data da execução:** 2026-09-18
- **Escopo:** `F:\Projetos\_FBR\GestaoDB` comparado com `F:\Projetos\_FBR\AuthorityEngine\GLOBAL-FLOW-AUTHORITY-BLOGS-FLUX-CONTROL-TOWER.md`.
- **Modo:** somente leitura; nenhuma migration, chamada remota, deploy ou mutação externa executada.

## Resultado executivo

A base local compila e a suíte existente passa, mas isso não demonstra prontidão do fluxo global. Foram encontrados **8 gaps adicionais ou mais específicos que o fluxo/documentos atuais não fecham**. Há dois achados críticos de segurança e quatro achados altos de integridade/autorização.

### Achados novos/priorizados

| ID | Severidade | Achado | Evidência verificável | Impacto |
|---|---|---|---|---|
| GDB-NEW-01 | **crítica** | Uma identidade com permissão para criar identities pode solicitar `scopes: ["*"]`; a API só bloqueia `identity_type=admin` para não-admin. O JWT emitido recebe esses scopes, e `hasRequiredScope()` trata `*` como autorização total. | `src/app/api/control-tower/identities/route.ts:20-40,55-80`; `src/lib/auth/control-tower.ts:199-203` | Escalada de privilégio: um principal autorizado a criar identity pode fabricar um token de serviço com acesso global. |
| GDB-NEW-02 | **crítica** | Editor SQL executa SQL arbitrário via RPC `security definer`; a rota não faz autorização por scope. O middleware aceita qualquer principal autenticado e a própria rota usa service-role. | `src/app/api/control-tower/projects/[slug]/sql/route.ts:7-47`; `supabase/migrations/009_control_tower_project_sql_exec.sql:1-31`; `src/middleware.ts:23-29` | Qualquer principal válido aceito pelo middleware pode alterar/destruir o schema de um projeto custom. A restrição `business_type=custom` não substitui `ct:sql:execute` + ownership/tenant check. |
| GDB-NEW-03 | **alta** | `business_type` e `template_key` são validados separadamente, sem validar o par. A RPC também não impõe a correspondência. | `src/app/api/control-tower/projects/route.ts:9-20`; `supabase/migrations/control_tower_final_schema.sql:328-357` | Projeto pode ser catalogado como blog com template de loja, recebendo schema de blog e metadata de template inconsistente. |
| GDB-NEW-04 | **alta** | Rebuild pode retornar sucesso mesmo quando a RPC falha: `await supabase.rpc(...)` não lança exceção quando Supabase retorna `{ error }`, e o código ignora o retorno. Também não há readback estrutural após o rebuild. | `src/app/api/control-tower/projects/[slug]/actions/route.ts:69-99` | Dashboard/job pode afirmar `success` com schema incompleto ou inexistente; viola o requisito de readback antes de avançar estado. |
| GDB-NEW-05 | **alta** | Provisionamento via POST não possui chave idempotente nem reconciliação por request/evento. O retry do cliente pode criar job/projeto duplicado ou falhar por slug sem devolver o recurso já criado. | `src/app/api/control-tower/projects/route.ts:41-89`; `provision_project` em `control_tower_final_schema.sql:328-387` | O Control Tower não é seguro contra retry/duplicação do fluxo automático descrito no documento global. |
| GDB-NEW-06 | **alta** | Artefatos não guardam versão da origem, hash/geração, actor real, readback ou vínculo a um snapshot de aprovação. A rota grava `created_by: 'admin-panel'` tanto para ações autenticadas por agente quanto por sessão. | `src/app/api/control-tower/projects/[slug]/configuration/route.ts:32-43`; migration `011_project_configuration_artifacts.sql:4-12` | Não é possível reconstruir com segurança qual versão de configuração foi aprovada/publicada, nem provar o readback correspondente ao pacote G6. |
| GDB-NEW-07 | **alta** | Namespace não é derivado/validado contra o projeto na API de namespaces/bindings. O caller escolhe `project_id`, namespace e provider; bindings aceitam qualquer `namespace_id` acessível ao principal, sem conferir tenant/projeto. | `src/app/api/control-tower/secrets/namespaces/route.ts:20-38`; `src/app/api/control-tower/secrets/bindings/route.ts:21-64` | Um principal com scope pode associar namespace de outro projeto ou registrar referência cruzada, quebrando isolamento e rastreabilidade de secrets. |
| GDB-NEW-08 | **média** | Developer Doc sempre calcula `fbr/blogs/<id>/` como namespace, inclusive para store, saas e custom, enquanto a geração de configuração usa `fbr/<business_type>/<id>`. | `src/app/api/control-tower/projects/[slug]/developer-doc/route.ts:67-70`; `src/lib/control-tower/project-configuration.ts:24-27` | Handoff e artefato oficial podem instruir runtimes a procurar secrets em namespaces diferentes. Falha operacional silenciosa no onboarding/deploy. |

## Gaps de consistência transacional observados

1. `archive` executa update de `projects` e insert em `audit_logs` em paralelo, sem transação; um pode persistir sem o outro (`actions/route.ts:27-46`).
2. `DELETE` remove schema, grava audit e exclui catálogo em operações separadas; se uma etapa falhar, o sistema fica parcialmente destruído ou com catálogo fantasma (`projects/[slug]/route.ts:25-65`). O audit insert também tem erro ignorado.
3. `secret_bindings` é gravado antes da injeção no provider; se a injeção falhar, a API devolve 502, mas deixa binding `active` persistido (`secrets/bindings/route.ts:61-90`).
4. A RPC `provision_project` atualiza o projeto para `error` no bloco de exceção, mas o `v_project_id` pode ainda estar nulo se a falha ocorrer antes do `INSERT`; o diagnóstico/audit de falha pode não ser gravado (`control_tower_final_schema.sql:381-386`).

## Divergências com critérios explícitos do fluxo global

- O documento global exige que aprovação integral contenha snapshot de versões, `provisioning_job_id`, `health_readback_id`, IDs de artifacts e bindings. GestaoDB hoje expõe os artifacts, mas não implementa esse pacote de aprovação nem um endpoint de readback consolidado.
- O documento exige falhas `waiting_external`, `retrying`, `blocked` e `failed`; o catálogo local usa `pending/running/success/error` em `provisioning_jobs`. A perda de semântica impede distinguir falha terminal, retry e bloqueio externo.
- O fluxo exige DNS manual + verificação automática. GestaoDB gera uma URL `/health`, mas não implementa, neste repositório, um verificador DNS/health associado a estado/versionamento do projeto.
- `organization_id` é opcional no catálogo e o POST aceita organização inexistente como `null`. Isso enfraquece o isolamento tenant exigido pelo contrato, mesmo antes das policies remotas.

## Verificações executadas

Comandos executados a partir de `F:\Projetos\_FBR\GestaoDB`:

- `npm test` → **exit 0**, 16 testes aprovados.
- `npm run typecheck` → **exit 0**.
- `npm run build` → **exit 0**, Next.js 15.5.20 compilado.
- `git status --short` → somente `tsconfig.tsbuildinfo` modificado pelo build; nenhuma mutação de código feita nesta auditoria.

Esses resultados validam apenas o estado local coberto pela suíte. Não validam migration remota, RLS/policies atuais, secrets, DNS, Easypanel, runtime público ou readback remoto.

## Recomendações de correção

1. **Bloquear imediatamente GDB-NEW-01 e GDB-NEW-02:** escopos permitidos por catálogo server-side; rejeitar `*` em criação por não-admin; exigir `ct:sql:execute`, actor/tenant e projeto autorizado na rota e na RPC; remover qualquer autorização implícita do middleware como substituto da autorização de negócio.
2. Criar schema/constraint ou função canônica `business_type → template_key`; rejeitar mismatch com 422 e cobrir teste negativo.
3. Fazer toda RPC retornar erro tratado na rota; registrar `failed/blocked` e executar readback estrutural (`schema`, tabelas esperadas, job, audit) antes de `success`.
4. Introduzir idempotency key/correlation ID para provisionamento e ações, com unique constraint e resposta do recurso já existente em retry.
5. Expandir `project_configuration_artifacts` e o modelo de aprovação com `source_version`, `generated_by`, `generated_at`, `hash`, `readback_id`, `approval_package_id` e actor server-side.
6. Derivar namespace exclusivamente do projeto; validar `namespace.project_id`/tenant em namespaces e bindings; bloquear `project_id=null` salvo caso explicitamente aprovado para namespace global.
7. Unificar o helper de namespace usado pelo Developer Doc e pelos artifacts.
8. Substituir operações destrutivas/parciais por RPCs transacionais ou compensação explícita; nunca retornar sucesso/erro sem reconciliar o estado persistido.

## Classificação final

- **FATO:** achados acima foram derivados de código/migrations locais e comandos reais; não houve acesso remoto nesta execução.
- **BLOQUEIO:** não foi possível provar estado remoto, RLS/policies aplicadas, DNS, Easypanel ou produção sem runtime autorizado; não concluir que o ambiente publicado possui exatamente o mesmo código.
- **HIPÓTESE:** o impacto operacional ocorrerá em produção se as rotas estiverem expostas com os principals previstos; a exploração deve ser confirmada em ambiente controlado, sem usar secrets reais.
- **DECISÃO recomendada:** não aprovar GDB como pronto para o fluxo global até fechar, no mínimo, GDB-NEW-01 a GDB-NEW-07 e obter readback remoto sanitizado.
