# Receipt — Runtime env.<slug> do Authority

**Data:** 2026-09-19  
**Projeto:** GestaoDB / Control Tower / Authority Engine  
**Task:** `CT-RUNTIME-20260919-AUTHORITY-ENV-IMPLEMENTATION`  
**Estado:** implementação local concluída; deploy/injeção remota não executados nesta tarefa.

## Implementado

- Registry de runtime extensível em `src/lib/control-tower/project-configuration.ts`.
- Perfil `authority` reconhecido por `slug=authorityengine` ou `schema_name=custom_authorityengine`.
- Inventário explícito para Authority contendo:
  - `NODE_ENV`, `APP_ENV`;
  - `CONTROL_TOWER_BASE_URL`;
  - `CONTROL_TOWER_PROJECT_ID`;
  - `CONTROL_TOWER_SCHEMA_NAME`;
  - `AUTHORITY_PROJECT_ID`;
  - `DATABASE_URL`;
  - `SUPABASE_URL`;
  - `SUPABASE_SERVICE_ROLE_KEY`;
  - `AUTHORITY_OWNER_ID`;
  - tokens `AUTHORITY_ADMIN/OPERATOR/REVIEWER/PUBLISHER/VIEWER`;
  - `PORT` e `HOST`.
- Classificação de cada variável por origem, obrigatoriedade, consumidor e validação.
- Geração canônica de nome:
  - produção: `env.<slug>`;
  - demais ambientes: `env.<slug>.<environment>`.
- Geração de documento completo `KEY=value` via `envDocument`.
- Valores derivados entram explicitamente; secrets aparecem somente como referências sanitizadas no documento persistido.
- Migration `014_runtime_env_documents.sql` adiciona `env_filename` e `env_document` a `project_runtime_contracts`.
- Endpoint `POST /api/control-tower/projects/[slug]/runtime-contract` persiste o documento e aceita `inject: true`.
- Endpoint aceita sessão admin do Control Tower ou token com scope apropriado.
- Injeção server-side preparada para `vps1/vps2`: resolve variáveis privadas do runtime do Control Tower, usa `EasypanelSecretsProvider`, faz update de env, deploy e readback de status.
- O botão existente “Gerar Variáveis do Runtime” passou a usar o endpoint `runtime-contract`, gerar `env.<slug>` e solicitar o fluxo de injeção.
- O botão não envia secrets ao navegador; o download contém o documento sanitizado com referências.

## Verificação executada

Diretório: `F:\Projetos\_FBR\GestaoDB`

- `npm test` → **51/51 aprovados**.
- `npm run typecheck` → **PASS**.
- `npm run build` → **PASS**; rota runtime-contract presente.
- `git diff --check` → **PASS**; apenas warnings de normalização LF/CRLF.
- Testes adicionados verificam:
  - `AUTHORITY_PROJECT_ID` derivado;
  - `AUTHORITY_OWNER_ID` obrigatório;
  - `AUTHORITY_ADMIN_TOKEN` obrigatório;
  - `env.authorityengine` em produção;
  - documento `KEY=value` com pelo menos o inventário completo;
  - ausência de secret plaintext no contrato local.

## Limitações e Gate remoto

- A migration 014 ainda não foi aplicada no Supabase remoto.
- O endpoint remoto runtime-contract anteriormente respondeu 404; o deploy da versão atual ainda é necessário.
- O clique real de injeção no Easypanel não foi executado pelo agente.
- A injeção exige `hosting_target`, nome do projeto Easypanel, credenciais do provider e todos os secrets necessários disponíveis server-side.
- O Control Tower ainda deve resolver os valores reais pelo Secret Manager/provider autorizado; referências sanitizadas não são suficientes para uma injeção real.
- Nenhuma variável, secret, deployment ou runtime externo foi alterado nesta execução.
