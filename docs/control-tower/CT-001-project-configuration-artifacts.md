# CT-001 — Artefatos de configuração por projeto

## Implementação local

- Adicionados três botões aos cards do Control Panel:
  - Gerar Variáveis Públicas
  - Gerar Namespace
  - Gerar Domínio de Validação
- Criada a rota `POST /api/control-tower/projects/[slug]/configuration`.
- Criada a rota `GET /api/control-tower/projects/[slug]/configuration` para consulta posterior.
- Criada a migration `011_project_configuration_artifacts.sql` com unicidade por projeto/tipo e atualização idempotente.
- Os artefatos são baixados pelo navegador após geração e gravados no banco.

## Regras aplicadas

- Blog gera namespace `fbr/blogs/<project_id>`; os demais usam `fbr/<business_type>/<project_id>`.
- Domínio gera `https://<dominio>/health`; sem domínio a API retorna erro explícito.
- `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` permanecem vazias no artefato. Nenhum secret é enviado ao frontend ou persistido por esta feature.

## Evidência local

- `node --experimental-strip-types --test tests/project-configuration.test.ts`: 5 aprovados.
- `npm run typecheck`: aprovado.
- `npm run build`: aprovado; rota incluída no output como `/api/control-tower/projects/[slug]/configuration`.

## Limitação / próximo gate

A migration não foi executada no Supabase remoto nesta etapa. É necessário aplicar a migration pelo fluxo autorizado do Control Tower/Supabase e então executar o POST/GET real com readback. Sem isso, a feature está implementada e validada localmente, mas não deve ser declarada publicada.

PROJECT_ROOT: `F:/Projetos/_FBR/GestaoDB`
EXECUTION_DIR: `F:/Projetos/_FBR/GestaoDB`
COMMAND: `node --experimental-strip-types --test tests/project-configuration.test.ts`; `npm run typecheck`; `npm run build`
RESULT: local aprovado; remoto pendente de migration/readback.
