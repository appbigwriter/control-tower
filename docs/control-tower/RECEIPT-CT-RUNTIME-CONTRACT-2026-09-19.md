# Receipt — CT Runtime Contract / Inventário / Developer Document

**Data:** 2026-09-19  
**Projeto:** GestaoDB / Control Tower  
**Estado:** implementação local concluída; aplicação/readback remoto pendentes de Gate.

## Implementado

- Migration `supabase/migrations/013_project_runtime_contracts.sql`.
- Modelo persistente `public.project_runtime_contracts` com:
  - project/environment/version/status;
  - namespace e service_name;
  - inventário sanitizado em `jsonb`;
  - Developer Document em markdown;
  - unicidade por projeto/ambiente/versão;
  - timestamps e índice de consulta.
- Funções em `src/lib/control-tower/project-configuration.ts`:
  - `buildRuntimeInventory`;
  - `buildRuntimeContract`;
  - `renderRuntimeDeveloperDocument`.
- API:
  - `POST /api/control-tower/projects/[slug]/runtime-contract` gera e registra o contrato;
  - `GET /api/control-tower/projects/[slug]/runtime-contract` faz readback;
  - `GET /api/control-tower/projects/[slug]/developer-doc` passa a exigir contrato registrado e entrega o documento persistido.
- Inventário inclui variáveis derivadas, privadas por referência e opcionais.
- Nenhum valor de secret é gerado, persistido ou retornado.
- `npm test` passou com 49/49.
- `npm run typecheck` passou.
- `npm run build` passou e a rota runtime-contract apareceu no output.
- `git diff --check` passou; warnings restantes são apenas normalização LF/CRLF do Git.

## Verificação de segurança

- Teste contratual confirma a migration, rota, upsert/versionamento e ausência de `secret_value`.
- Teste puro confirma referências `secret-manager:` e ausência de valores secretos no Developer Document.
- A primeira versão não grava `.env` em pasta nem injeta automaticamente em VPS/Easypanel.

## Pendente / bloqueado

- Aplicar migration 013 no Supabase remoto pelo fluxo autorizado.
- Fazer POST real autenticado para um projeto de teste.
- Ler o contrato de volta via GET.
- Ler o Developer Document persistido.
- Confirmar RLS/policies/readback remoto e registrar status `verified`.

Nenhuma migration, deploy ou mutação remota foi executada nesta implementação local.
