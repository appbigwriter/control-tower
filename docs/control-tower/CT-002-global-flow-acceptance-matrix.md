# CT-002 — Matriz de aceitação do fluxo global (Track D)

**Escopo:** auditoria local somente. Nenhuma migration foi aplicada e nenhum sistema remoto foi mutado.
**Ownership:** Track D. A matriz e os testes abaixo não alteram o núcleo do Flux Track C; a integração Flux → Control Tower permanece ownership do coordenador/Track C.

## Regra de evidência

- **file-defined:** declarado em código, migration, fixture ou documentação local.
- **application-reported:** resposta produzida por uma API/aplicação; não foi obtida remotamente nesta auditoria.
- **application-verified:** assert/test local confirma o comportamento do código ou harness.
- **readback-verified:** leitura posterior do estado persistido confirma o resultado; somente o readback local simulado de QA-016 foi verificado.
- Valores secretos nunca entram na matriz, fixture ou saída de teste.

## Matriz

| ID | Critério global | Evidência local | Classificação | Dono / próximo gate |
|---|---|---|---|---|
| CT-D-01 | Criar/reconciliar projeto | `src/app/api/control-tower/projects/route.ts` chama `provision_project`; fluxo é definido em `control_tower_final_schema.sql`/runbook | implemented; application-verified apenas por leitura de código | Control Tower; executar teste autorizado e readback após migration |
| CT-D-02 | Provisionar/reconciliar schema por tipo | `supabase/migrations/010_complete_schema_provisioning.sql` valida nome e usa `create schema if not exists`; funções por `blog/store/saas/custom` | file-defined; local SQL execution não realizada neste job | Control Tower; validar SQL em banco local limpo antes de qualquer remoto |
| CT-D-03 | Persistir artefato de configuração pública | `011_project_configuration_artifacts.sql`; rota `/api/control-tower/projects/[slug]/configuration`; `buildPublicVariables` deixa chaves secretas vazias | implemented; application-verified pelo teste local | Control Tower; migration e POST/GET reais pendentes |
| CT-D-04 | Criar namespace | `POST/GET /api/control-tower/secrets/namespaces`; unique `namespace` e `upsert ... onConflict: namespace` | implemented; file-defined, sem readback remoto | Control Tower; confirmar auth/scope e readback autorizado |
| CT-D-05 | Registrar secret-ref sem imprimir segredo | `POST/GET /api/control-tower/secrets/bindings`; persiste `reference_path`; rejeita `secret_value` para não-admin e GET não seleciona valor | implemented; application-verified por inspeção/teste de contrato | Control Tower; confirmar policy/adapter com credencial autorizada, sem expor valores |
| CT-D-06 | Gerar domínio de validação `/health` | `buildValidationDomain` normaliza HTTPS e produz `<domain>/health`; `src/app/api/control-tower/health/route.ts` retorna healthy/degraded/unhealthy | implemented; application-verified localmente | Control Tower; health real depende de runtime/configuração |
| CT-D-07 | Persistir artefatos e fazer readback | POST faz upsert e retorna `saved`; GET consulta artefatos ordenados | implemented; readback-verified somente no contrato local, remoto pending | Control Tower + coordenador; aplicar migration autorizada e ler POST/GET de volta |
| CT-D-08 | Reconciliar idempotentemente | Artefatos: unique `(project_id, artifact_type)` + upsert; namespaces: unique + upsert; bindings: unique `(namespace_id, secret_name, environment)` + upsert; schema: `if not exists` | implemented by local definitions; runtime repetition not exercised against DB | Control Tower; criar/rodar smoke local com banco descartável ou fixture adapter |
| CT-D-09 | Flux recebe resultado, receipt e readback | Harness `09-codigo/src/lib/flux-qa-016-harness.ts` cobre apenas `simulated_provisioning` + readback local, com `externalActionAuthorized:false`; não chama CT | local simulated and application-verified in existing QA-016 test; real integration pending | Flux Track C/coordinator; não implementar integração neste Track D |
|| CT-D-10 | Segurança/autorização da configuração | `src/app/api/control-tower/projects/[slug]/configuration/route.ts` agora chama `authenticateToken` e exige `projects:provision` no POST e `projects:read` no GET | local fix implemented; tests/typecheck/build verified; remote policy/readback pending | Control Tower owner; validar policy/scope em ambiente autorizado sem expor secrets |
| CT-D-11 | Migrations canônicas sem colisão | Runbook registra dois `010` e dois `011`, e proíbe aplicação indiscriminada | blocked: sequencing decision required | Coordinator/Control Tower; decisão formal de versionamento e histórico remoto |
| CT-D-12 | Readback remoto e health real | Documentação CT-001 e runbook proíbem declarar publicação sem migration/readback | pending/blocked by authorization, credentials and Gate | Sergio/coordinator; backup, Gate, migration, POST/GET, health, readback, rollback evidence |

## Acceptance local-only

1. `npm test` (GestaoDB) permanece local e não acessa endpoint remoto.
2. `tests/control-tower-acceptance-contract.test.mjs` verifica os contratos textuais existentes, unicidade/upsert e ausência de valores secretos no artefato público.
3. O fixture usado pelo teste contém somente nomes de rotas e expectativas; não contém token, URL de provider ou valor secreto.
4. O E2E local QA-016 existente continua explicitamente simulado e sem efeito externo; ele não é prova de integração CT real.

## Handoff

**Implementado/verificado:** contratos locais de projeto, schema, artefatos públicos, namespace, secret-ref, health e idempotência estão mapeados; a prova local foi adicionada sem mutar runtime.

**Pendente:** executar testes de rota/DB com fixture local descartável e obter readback real após migration autorizada.

**Bloqueado:** auth/scope da rota `/configuration`, colisão de numeração 010/011, integração real Flux → Control Tower, provider endpoint não especificado e qualquer mutação remota.
