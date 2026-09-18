# Tasklist de Remediação dos Gaps do GestaoDB

- **Projeto:** GestaoDB / Control Tower
- **Fonte dos gaps:** `GDB-AUDIT-20260918-FLOW-GAPS.md`
- **Contrato de referência:** `F:\Projetos\_FBR\AuthorityEngine\GLOBAL-FLOW-AUTHORITY-BLOGS-FLUX-CONTROL-TOWER.md`
- **Owner de coordenação:** David
- **Gate estrutural:** Sergio aprova migrations remotas, rotação de secrets, deploy e readback de produção.
- **Estado geral:** planejada; execução ainda não iniciada.
- **Regra:** nenhuma task é concluída por plano, build verde ou relato do agente. Cada item exige evidência objetiva e readback quando houver estado externo.

## Ordem de execução

```text
GDB-REM-001 Segurança base
        ↓
GDB-REM-002 Autorização por rota/tenant
        ↓
GDB-REM-003 Integridade de provisionamento
        ↓
GDB-REM-004 Idempotência e estados
        ↓
GDB-REM-005 Artefatos, namespaces e aprovação
        ↓
GDB-REM-006 Transações e compensação
        ↓
GDB-REM-007 DNS/health/readbacks
        ↓
GDB-REM-008 Testes negativos e E2E local
        ↓
GDB-REM-009 Migration, readback remoto e deploy controlado
        ↓
GDB-REM-010 Gate final de prontidão
```

## Fase 0 — Segurança e autorização

### GDB-REM-001 — Fechar escalada de privilégio em Service Identities
- **Gap:** GDB-NEW-01
- **Prioridade:** P0 / crítica
- **Owner:** David; Sergio para Gate remoto
- **Escopo:** catálogo server-side de scopes permitidos; rejeitar `*` em criação por não-admin; impedir criação de scope administrativo por principal não-admin; ignorar `created_by` enviado pelo cliente; validar `expires_in`; impedir emissão de JWT com escopos fora da matriz.
- **Dependências:** nenhuma.
- **Aceite:**
  1. Dado um principal não-admin, `scopes: ["*"]` retorna 403/422 e não cria identity.
  2. Dado qualquer scope não catalogado, a API rejeita o payload.
  3. `created_by` no registro é derivado do principal autenticado.
  4. Um token emitido por identity não-admin nunca obtém autorização equivalente a admin.
  5. Testes negativos cobrem wildcard, `identities:create`, `ct:sql:execute` e criação de identity admin.
- **Evidência:** diff, migration/constraint se necessária, testes negativos, resposta sanitizada e readback da identity.
- **Estado:** bloqueada — agente executou alterações parciais, mas terminou sem handoff por limite de uso do z.ai/GLM 5.2 (`HTTP 429`, reset informado para 2026-09-19 05:26:16Z); owner do desbloqueio: provider z.ai/infra; next check: após reset; closure: reconciliação independente + handoff + suíte aprovada.

### GDB-REM-002 — Aplicar autorização por rota e tenant
- **Gaps:** GDB-NEW-02, GDB-NEW-07 e exposição transversal de rotas.
- **Prioridade:** P0 / crítica
- **Owner:** David; Sergio para revisão do contrato RLS/RBAC
- **Escopo:** criar helper único de `requirePrincipal`/`requireScope`; exigir scope específico em projects, actions, SQL, configuration, namespaces, bindings, identities e handoffs; validar projeto, namespace e organização do principal; não usar middleware como autorização de negócio.
- **Dependências:** GDB-REM-001; contrato `F0-SEC-003`.
- **Aceite:**
  1. Sem credencial, todas as rotas protegidas retornam 401.
  2. Com credencial válida sem scope, a rota retorna 403.
  3. Principal de outro tenant não lê nem altera projeto, namespace, binding ou artifact.
  4. SQL custom exige `ct:sql:execute` e autorização explícita sobre o projeto.
  5. Sessão de navegador não bypassa autorização de escopo/tenant.
- **Evidência:** matriz rota→scope→tenant, testes 401/403/cross-tenant, diff e relatório de revisão.
- **Estado:** bloqueada — agente terminou sem handoff por limite de uso do z.ai/GLM 5.2 (`HTTP 429`, reset 2026-09-19 05:26:16Z); alterações compartilhadas podem estar parciais; owner do desbloqueio: provider z.ai/infra; closure: reconciliação independente + handoff + suíte aprovada.

### GDB-REM-003 — Restringir e auditar o RPC de SQL por schema
- **Gap:** GDB-NEW-02
- **Prioridade:** P0 / crítica
- **Owner:** David; Sergio para Gate SQL remoto
- **Escopo:** RPC deve validar que o schema pertence ao projeto solicitado, rejeitar `public`, bloquear operações proibidas conforme política, exigir contexto de actor/tenant e registrar audit log sanitizado. Avaliar se SQL arbitrário deve ser substituído por operações allowlisted.
- **Dependências:** GDB-REM-002.
- **Aceite:**
  1. RPC não executa com schema não cadastrado ou pertencente a outro projeto.
  2. `public` e schemas de governança são rejeitados.
  3. Tentativas negadas geram audit log sem SQL sensível.
  4. Execução autorizada altera somente o schema alvo e possui readback.
  5. Nenhuma policy/migration remota é aplicada antes do Gate de Sergio.
- **Evidência:** migration/RPC, testes de isolamento, audit readback e plano de rollback.
- **Estado:** bloqueada — agente executou alterações parciais, mas terminou sem handoff por limite de uso do z.ai/GLM 5.2 (`HTTP 429`, reset informado para 2026-09-19 05:26:16Z); owner do desbloqueio: provider z.ai/infra; next check: após reset; closure: reconciliação independente + handoff + suíte aprovada.

## Fase 1 — Integridade do provisionamento

### GDB-REM-004 — Enforçar correspondência business type/template
- **Gap:** GDB-NEW-03
- **Prioridade:** P1 / alta
- **Owner:** David
- **Escopo:** helper canônico e constraint/trigger/RPC que mapeia `blog→blog_standard`, `store→store_standard`, `saas→saas_standard`, `custom→custom_base`; rejeitar template inexistente/inativo.
- **Dependências:** nenhuma; pode executar em paralelo com GDB-REM-001.
- **Aceite:**
  1. Payload mismatch retorna 422 antes de criar projeto/job/schema.
  2. RPC também rejeita mismatch quando chamada diretamente.
  3. Template inativo não provisiona.
  4. Testes cobrem todos os quatro pares válidos e combinações inválidas.
- **Evidência:** diff, migration/constraint, testes e ausência de registros em tentativa inválida.
- **Estado:** bloqueada — alterações parciais em handlers/migrations; execução terminou por limite de uso do z.ai/GLM 5.2 (`HTTP 429`, reset 2026-09-19 05:26:16Z) e houve sobreposição com tracks irmãos; exige reconciliação independente + handoff.

### GDB-REM-005 — Corrigir tratamento de erro e readback do rebuild
- **Gap:** GDB-NEW-04
- **Prioridade:** P1 / alta
- **Owner:** David
- **Escopo:** tratar explicitamente `{ data, error }` de todas as RPCs; marcar job como `failed`/`blocked`; executar readback de schema/tabelas esperadas/job/audit antes de `success`.
- **Dependências:** GDB-REM-004; contrato de estados em GDB-REM-007.
- **Aceite:**
  1. RPC que retorna erro nunca produz HTTP 200 nem job `success`.
  2. Falha persiste erro sanitizado e próximo estado correto.
  3. Rebuild bem-sucedido só retorna após readback das tabelas esperadas.
  4. Rebuild parcial é classificado como blocked/failed e não como active.
- **Evidência:** testes com RPC simulada em erro, readback local e relatório de estados.
- **Estado:** bloqueada — alterações parciais em handlers/migrations; execução terminou por limite de uso do z.ai/GLM 5.2 (`HTTP 429`, reset 2026-09-19 05:26:16Z) e houve sobreposição com tracks irmãos; exige reconciliação independente + handoff.

### GDB-REM-006 — Tornar provisionamento idempotente
- **Gap:** GDB-NEW-05
- **Prioridade:** P1 / alta
- **Owner:** David; Flux para contrato de correlation/evento
- **Escopo:** aceitar `Idempotency-Key`/`correlation_id`; persistir chave e request fingerprint; unique constraint por operação; retry deve retornar projeto/job original; reconciliar schema existente sem duplicar.
- **Dependências:** GDB-REM-004; alinhamento com inbox/jobs do Agency Flux.
- **Aceite:**
  1. Repetição do mesmo request retorna o mesmo `project_id`/job.
  2. Reuso da chave com payload diferente retorna conflito explícito.
  3. Timeout após criação seguido de retry reconcilia o estado real.
  4. Eventos duplicados não criam schema, namespace ou projeto duplicado.
- **Evidência:** testes de replay/concurrency, unique constraint, readback de contagens e contrato documentado.
- **Estado:** bloqueada — alterações parciais em handlers/migrations; execução terminou por limite de uso do z.ai/GLM 5.2 (`HTTP 429`, reset 2026-09-19 05:26:16Z); exige reconciliação independente + handoff.

### GDB-REM-007 — Alinhar estados, retries, blockers e falhas
- **Gaps:** divergência de estados do fluxo global.
- **Prioridade:** P1 / alta
- **Owner:** David / Agency Flux
- **Escopo:** definir máquina de estados canônica para projeto/job; incluir `waiting_external`, `retrying`, `blocked`, `failed`; toda transição registra before/after, actor, motivo, timestamp, correlation e evidência.
- **Dependências:** GDB-REM-005 e GDB-REM-006.
- **Aceite:**
  1. Transições inválidas são rejeitadas.
  2. Retry possui `attempt_count`, `next_retry_at` e `last_error` sanitizado.
  3. Blocked possui owner, `nextCheck` e closure criterion.
  4. Não existe retorno `success` sem evidência/readback.
- **Evidência:** tabela/contrato, testes de transição e readback de histórico.
- **Estado:** bloqueada — alterações parciais em handlers/migrations; execução terminou por limite de uso do z.ai/GLM 5.2 (`HTTP 429`, reset 2026-09-19 05:26:16Z); exige reconciliação independente + handoff.

## Fase 2 — Artefatos, namespaces e aprovação

### GDB-REM-008 — Versionar artifacts e pacote de aprovação G6
- **Gap:** GDB-NEW-06
- **Prioridade:** P1 / alta
- **Owner:** David; Sergio para aprovação do pacote
- **Escopo:** modelar artifacts com `source_version`, `generated_by`, `generated_at`, hash, `readback_id`, `approval_package_id`, correlation e actor; implementar snapshot contendo persona/blog/domain/job/health/artifacts/bindings.
- **Dependências:** GDB-REM-006 e GDB-REM-007; contratos Authority/Flux.
- **Aceite:**
  1. Regeneração cria versão/rastreabilidade sem sobrescrever a evidência aprovada.
  2. Pacote G6 referencia todos os IDs exigidos pelo fluxo global.
  3. Mudança posterior em qualquer versão invalida o pacote anterior.
  4. Actor não pode ser informado arbitrariamente pelo cliente.
  5. GET de readback reconstrói exatamente o pacote aprovado.
- **Evidência:** migration, API, testes de stale package e readback local.
- **Estado:** bloqueada — dois dispatches z.ai/GLM 5.2 falharam por HTTP 429; owner do desbloqueio: provider z.ai/infra; next check: após janela de rate limit; closure: handoff + diff + testes verificáveis.

### GDB-REM-009 — Corrigir ownership e derivação de namespaces
- **Gap:** GDB-NEW-07
- **Prioridade:** P1 / alta
- **Owner:** David
- **Escopo:** namespace deve ser derivado do projeto e business type; rejeitar `project_id=null` salvo namespace global explicitamente catalogado; validar provider; bindings devem conferir namespace→project→organization.
- **Dependências:** GDB-REM-002; GDB-REM-008.
- **Aceite:**
  1. Cliente não consegue escolher namespace divergente do projeto.
  2. Cross-tenant namespace/binding retorna 403/404 sem vazamento.
  3. Namespace duplicado é reconciliado apenas para o mesmo projeto.
  4. Bindings de falha não permanecem `active` sem injeção confirmada.
- **Evidência:** testes cross-tenant, migration/policies e readback sanitizado.
- **Estado:** pendente.

### GDB-REM-010 — Unificar namespace dos handoffs
- **Gap:** GDB-NEW-08
- **Prioridade:** P1 / alta
- **Owner:** David
- **Escopo:** remover `fbr/blogs` hardcoded do Developer Doc e reutilizar helper canônico em Developer, BigWriter, Frontend/AdSense e artifacts.
- **Dependências:** GDB-REM-009.
- **Aceite:**
  1. Blog/store/saas/custom produzem o mesmo namespace em todos os handoffs.
  2. Testes cobrem os quatro tipos.
  3. Nenhum handoff contém secret real.
- **Evidência:** diff, testes e comparação automatizada dos documentos.
- **Estado:** bloqueada — dois dispatches z.ai/GLM 5.2 falharam por HTTP 429; owner do desbloqueio: provider z.ai/infra; next check: após janela de rate limit; closure: handoff + diff + testes verificáveis.

## Fase 3 — Consistência transacional e operação

### GDB-REM-011 — Tornar archive/delete/rebuild atomicamente seguros
- **Gaps:** operações parciais de archive/delete/rebuild.
- **Prioridade:** P1 / alta
- **Owner:** David; Sergio para operações destrutivas
- **Escopo:** substituir operações paralelas por RPC transacional ou saga compensatória; garantir audit obrigatório; evitar catálogo fantasma e schema órfão; delete deve exigir confirmação explícita e registrar receipt.
- **Dependências:** GDB-REM-007.
- **Aceite:**
  1. Falha em qualquer etapa deixa estado documentado e reconciliável.
  2. Archive não retorna sucesso sem audit persistido.
  3. Delete não remove catálogo antes de confirmar resultado da remoção do schema, ou deixa estado blocked explícito.
  4. Ação destrutiva não é executada sem Gate exigido.
- **Evidência:** testes de falha intermediária, RPC/saga, audit readback e plano rollback.
- **Estado:** bloqueada — execução parcial sem handoff por limite de uso do z.ai/GLM 5.2 (`HTTP 429`, reset 2026-09-19 05:26:16Z); diffs e testes exigem reconciliação independente.

### GDB-REM-012 — Corrigir falha de binding/provider e provisionamento parcial
- **Gaps:** binding ativo após injeção falha; `v_project_id` possivelmente nulo na exceção.
- **Prioridade:** P1 / alta
- **Owner:** David
- **Escopo:** status intermediário `pending/failed`, confirmação de provider antes de `active`, compensação/retry; corrigir tratamento de exceção da RPC e registrar falhas sem projeto quando aplicável.
- **Dependências:** GDB-REM-007 e GDB-REM-009.
- **Aceite:**
  1. Provider falho nunca deixa binding ativo confirmado.
  2. Retry é seguro e observável.
  3. Falha antes de project insert não gera audit inválido nem mascara erro.
  4. Readback distingue intenção, tentativa e confirmação externa.
- **Evidência:** testes com provider mock falho, readback e logs sanitizados.
- **Estado:** bloqueada — execução parcial sem handoff por limite de uso do z.ai/GLM 5.2 (`HTTP 429`, reset 2026-09-19 05:26:16Z); diffs e testes exigem reconciliação independente.

### GDB-REM-013 — Implementar DNS/health/readback técnico
- **Gaps:** ausência de verificação DNS/health vinculada ao projeto.
- **Prioridade:** P1 / alta
- **Owner:** David / Infra
- **Escopo:** estados `domain_generated → awaiting_dns → dns_manual_confirmed → dns_verified`; verificação técnica com timeout/retry; persistir readback, timestamp e erro sanitizado.
- **Dependências:** GDB-REM-007 e GDB-REM-008.
- **Aceite:**
  1. Domínio sem DNS válido não avança para provisionamento/publicação.
  2. Confirmação manual sem verificação técnica permanece bloqueada.
  3. Health readback integra o pacote G6.
  4. Timeout/falha gera retry ou blocker com next check.
- **Evidência:** testes com DNS/health mockados, estados persistidos e readback.
- **Estado:** bloqueada — execução parcial sem handoff por limite de uso do z.ai/GLM 5.2 (`HTTP 429`, reset 2026-09-19 05:26:16Z); diffs e testes exigem reconciliação independente.

## Fase 4 — Qualidade, integração e Gates

### GDB-REM-014 — Ampliar suíte de testes de segurança e contratos
- **Escopo:** cobrir todos os critérios acima sem chamar rede real.
- **Prioridade:** P1 / alta
- **Owner:** David / QA
- **Dependências:** GDB-REM-001 a GDB-REM-013 conforme cada teste.
- **Aceite:**
  1. `npm test` passa incluindo 401/403, wildcard, cross-tenant, mismatch, replay e falhas de RPC/provider.
  2. `npm run typecheck` passa.
  3. `npm run build` passa.
  4. Testes não usam secrets reais nem migration remota.
  5. Cada gap GDB-NEW-01..08 possui teste de regressão.
- **Evidência:** saída completa dos comandos, cobertura/matriz de testes e relatório QA.
- **Estado:** bloqueada — suíte criada/alterada parcialmente, mas sem execução final aprovada e sem handoff por limite de uso do z.ai/GLM 5.2 (`HTTP 429`, reset 2026-09-19 05:26:16Z).

### GDB-REM-015 — E2E local Authority → Flux → Blogs → Control Tower
- **Escopo:** reproduzir o fluxo global com adapters/mocks explícitos, sem publicação real.
- **Prioridade:** P1 / alta
- **Owner:** David / Authority / Flux / Blogs
- **Dependências:** GDB-REM-006, GDB-REM-007, GDB-REM-008, GDB-REM-013 e contratos dos demais módulos.
- **Aceite:**
  1. Dados-base criam Persona/blog rastreável.
  2. Aprovação gera evento idempotente.
  3. Flux cria job e handoff.
  4. Control Tower provisiona/reconcilia projeto, namespace e artifacts.
  5. Readback confirma cada etapa.
  6. Publicação permanece bloqueada sem Gate integral.
- **Evidência:** execução E2E, receipts, estados antes/depois e artefatos sanitizados.
- **Estado:** bloqueada — harness/testes E2E parciais, sem handoff e sem suíte final aprovada por limite de uso do z.ai/GLM 5.2 (`HTTP 429`, reset 2026-09-19 05:26:16Z).

### GDB-REM-016 — Migration runbook, backup, rollback e readback remoto
- **Escopo:** consolidar migrations sem colisão, dependências, backup, rollback, ordem de aplicação e queries de verificação.
- **Prioridade:** P0 / Gate obrigatório
- **Owner:** David; Sergio/owner Supabase executa
- **Dependências:** todas as migrations locais aprovadas e GDB-REM-014.
- **Aceite:**
  1. Registry canônico das migrations aprovado.
  2. Backup/rollback testados ou explicitamente justificados.
  3. Aplicação remota somente após aprovação explícita de Sergio.
  4. Readback confirma tabelas, constraints, funções, owners, RLS/policies e contagens.
  5. Nenhum secret aparece no relatório.
- **Evidência:** runbook, receipt de aplicação, queries sanitizadas e resultado antes/depois.
- **Estado:** bloqueada até Gate de Sergio.

### GDB-REM-017 — Deploy controlado e readback público
- **Escopo:** publicar somente commit auditado; validar API, UI, health, auth, artifacts, namespaces, jobs e logs.
- **Prioridade:** P0 / Gate obrigatório
- **Owner:** David / Théo; Sergio para aprovação de publicação
- **Dependências:** GDB-REM-014, GDB-REM-015 e GDB-REM-016.
- **Aceite:**
  1. Commit implantado coincide com o commit auditado.
  2. Health retorna estado correto sem expor internals sensíveis.
  3. Rotas negativas 401/403 passam remotamente.
  4. Provisionamento/rebuild/configuração têm readback remoto confirmado.
  5. Nenhum secret aparece em frontend, download, evento ou log.
- **Evidência:** commit/deploy ID, URLs, respostas sanitizadas, screenshots/logs e receipt.
- **Estado:** bloqueada até Gates prévios.

### GDB-REM-018 — Gate final de prontidão do GestaoDB
- **Escopo:** auditoria independente de todos os itens e decisão de pronto/não pronto.
- **Prioridade:** P0 / Gate final
- **Owner:** David; Sergio decide aprovação
- **Dependências:** GDB-REM-017.
- **Aceite:**
  1. GDB-NEW-01..08 estão corrigidos e cobertos por regressão.
  2. Testes local e remoto passam.
  3. Readbacks do fluxo completo existem.
  4. Blockers remanescentes possuem owner, next action, next check e closure criterion.
  5. Sergio registra decisão explícita: aprovado, aprovado com restrições ou reprovado.
- **Evidência:** relatório final, matriz de aceite, receipt do Gate e atualização do STATUS/tasklist.
- **Estado:** bloqueada até conclusão das fases anteriores.

## Matriz de cobertura dos gaps

| Gap | Tasks |
|---|---|
| GDB-NEW-01 — wildcard/escalada de identity | GDB-REM-001, 002, 014 |
| GDB-NEW-02 — SQL sem scope/tenant | GDB-REM-002, 003, 014 |
| GDB-NEW-03 — template incompatível | GDB-REM-004, 014 |
| GDB-NEW-04 — rebuild falso sucesso | GDB-REM-005, 007, 014 |
| GDB-NEW-05 — ausência de idempotência | GDB-REM-006, 007, 015 |
| GDB-NEW-06 — artifacts sem snapshot/readback | GDB-REM-008, 013, 015 |
| GDB-NEW-07 — namespace cross-tenant | GDB-REM-002, 009, 012, 014 |
| GDB-NEW-08 — namespace divergente no Developer Doc | GDB-REM-010, 014 |
| Archive/delete/bindings parciais | GDB-REM-011, 012, 014 |
| DNS/health/readback ausente | GDB-REM-013, 015, 016, 017 |

## Definition of Done global

- [ ] Todos os GDB-NEW-01..08 possuem correção implementada e teste de regressão.
- [ ] Autorização é por principal, scope e tenant; middleware não substitui autorização de negócio.
- [ ] Provisionamento e eventos são idempotentes e reconciliáveis.
- [ ] Nenhum sucesso é retornado sem readback verificável.
- [ ] Artifacts, secrets, namespaces, jobs e aprovações têm versionamento e auditoria.
- [ ] Falhas distinguem retry, blocker, falha terminal e dependência externa.
- [ ] Teste E2E local reproduz o fluxo completo sem publicação real.
- [ ] Migration remota, deploy e readback público foram aprovados e verificados por Gate.
- [ ] Relatório final e receipt foram gravados no histórico do projeto.
