# GestaoDB

Base do Control Tower para provisionamento e governanca de projetos em Supabase.

## Deploy na VPS

O projeto foi preparado para rodar como container `standalone`.

### Variáveis de ambiente

Configure as variáveis no painel do provedor ou no ambiente de execução:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
CONTROL_TOWER_ADMIN_SECRET=
NEXT_PUBLIC_APP_NAME=Control Tower
```

### Build e execução

```bash
npm install
npm run build
npm run start
```

### Container

```bash
docker build -t gestaodb-control-tower .
docker run -p 3000:3000 --env-file .env.local gestaodb-control-tower
```

## Rodar localmente

```bash
npm install
npm run dev
```

## Integração Easypanel REST

A configuração é injetada exclusivamente no runtime do serviço. Nunca grave tokens no repositório ou em logs:

```env
EASYPANEL_API_URL=https://easypanel.example/api
EASYPANEL_API_TOKEN=<runtime-secret-reference>
EASYPANEL_PROJECT_NAME=projetos
```

O adapter usa a API REST oficial do Easypanel 2.34.0, com `Authorization: Bearer`, e normaliza a URL para uma única base `/api`. O projeto vem de `EASYPANEL_PROJECT_NAME` e mantém `projetos` como default; o `serviceName` é dinâmico e deriva do namespace, por exemplo `fbr/gestaodb` → `gestaodb`.

Endpoints oficiais usados:

- `GET /api/listProjectsAndServices`
- `GET /api/inspectAppService?projectName=projetos&serviceName=gestaodb`
- `POST /api/createAppService`
- `POST /api/updateAppEnv`
- `POST /api/deployAppService`
- `POST /api/destroyAppService`
- `GET /api/listActions`
- `GET /api/getAction?id=<action-id>`

Após cada mutação o adapter faz readback oficial. Ele não inventa `running`: estados desconhecidos retornam `NOT_VERIFIED`. `injectSecrets` cria ou localiza, atualiza ambiente, verifica configuração, faz deploy e inspeciona novamente; destruição só ocorre pela operação explícita `destroy`.

### Gates locais

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run contract:fixture
```

### Homologação remota opt-in

O script abaixo exige apenas variáveis de runtime, usa um marcador não secreto, aborta se o readback não confirmar a criação e não destrói serviço pré-existente:

```bash
EASYPANEL_API_URL=https://easypanel.example/api \
EASYPANEL_API_TOKEN="$EASYPANEL_API_TOKEN" \
EASYPANEL_PROJECT_NAME=projetos \
EASYPANEL_HOMOLOGATION_NAMESPACE=homologation/unique-service \
npm run easypanel:homologation
```

A homologação remota não foi executada durante a validação local. Contrato detalhado: [`docs/easypanel-rest-contract.md`](docs/easypanel-rest-contract.md).

## Estrutura

- `src/app` - rotas do Next.js
- `src/components` - componentes da interface
- `src/lib` - cliente Supabase e utilitarios
- `supabase` - migracoes e seed
- `docs` - especificacao do produto
