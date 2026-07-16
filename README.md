# GestaoDB

Base do Control Tower para provisionamento e governanca de projetos em Supabase.

## Deploy na VPS

O projeto foi preparado para rodar como container `standalone`.

### Variáveis de ambiente

Crie as variáveis no painel do provedor ou no arquivo de ambiente da VPS:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
CONTROL_TOWER_ADMIN_SECRET=
NEXT_PUBLIC_APP_NAME=Control Tower
```

### Build e execução

```powershell
npm install
npm run build
npm run start
```

### Container

```powershell
docker build -t gestaodb-control-tower .
docker run -p 3000:3000 --env-file .env.local gestaodb-control-tower
```

### Observações para a VPS com Supabase

- O Control Tower pode rodar na mesma VPS do Supabase sem compartilhar a mesma porta.
- Garanta que o app esteja em porta diferente do Supabase/PostgREST/Studio.
- Se usar Easypanel, aponte o serviço para o `Dockerfile` da raiz.
- Configure o domínio/subdomínio do Control Tower separado do domínio do Supabase.

## Rodar localmente

```powershell
npm install
npm run dev
```

## Estrutura

- `src/app` - rotas do Next.js
- `src/components` - componentes da interface
- `src/lib` - cliente Supabase e utilitarios
- `supabase` - migracoes e seed
- `docs` - especificacao do produto
