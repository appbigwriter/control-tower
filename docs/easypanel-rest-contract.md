# Easypanel REST contract

## Official source

The adapter follows the OpenAPI document served by the Easypanel 2.34.0 instance:

- `https://easypanel.fbrapps.com/api/openapi.json`
- OpenAPI version reported by the document: `3.1.1`
- Easypanel API version: `2.34.0`
- API base: `/api`
- Authentication: `Authorization: Bearer <EASYPANEL_API_TOKEN>`

`EASYPANEL_API_URL` accepts the server root or a URL ending in `/api`; the adapter normalizes both forms to exactly one `/api` suffix.

## Endpoints used by the adapter

| Method | Path | Parameters/body |
|---|---|---|
| GET | `/api/listProjectsAndServices` | no query parameters |
| GET | `/api/inspectAppService` | required query: `projectName`, `serviceName` |
| POST | `/api/createAppService` | required JSON: `projectName`, `serviceName`; optional service configuration follows the OpenAPI schema |
| POST | `/api/updateAppEnv` | required JSON: `projectName`, `serviceName`; `env` is a newline-delimited string, not an object |
| POST | `/api/deployAppService` | required JSON: `projectName`, `serviceName`; optional `forceRebuild` |
| POST | `/api/destroyAppService` | required JSON: `projectName`, `serviceName` |
| GET | `/api/listActions` | optional query: `limit`, `projectName`, `serviceName`, `type` |
| GET | `/api/getAction` | required query: `id` |

The two read endpoints are authenticated GET requests. Their response schema is intentionally open in OpenAPI, so the adapter returns the observed JSON and does not synthesize a provider status. Unknown service states map to `NOT_VERIFIED`.

## Runtime configuration

```env
EASYPANEL_API_URL=https://easypanel.example/api
EASYPANEL_API_TOKEN=<runtime-secret-reference>
EASYPANEL_PROJECT_NAME=projetos
```

`EASYPANEL_API_TOKEN` is mandatory. `EASYPANEL_PROJECT_NAME` defaults to the fixed project `projetos` when omitted and is validated as an Easypanel identifier. `serviceName` is dynamic: it is derived from the last non-empty namespace segment, for example `fbr/gestaodb` → `gestaodb`. `EASYPANEL_SERVICE_NAME` is not used.

## Provisioning/readback sequence

`injectSecrets(namespace, secrets)` performs:

1. `listProjectsAndServices` pre-check
2. `createAppService` only when the dynamic service is absent
3. list readback; aborts if creation is not confirmed
4. `updateAppEnv` with newline-delimited `KEY=value` data
5. `inspectAppService` readback; aborts if the requested environment is not observed
6. `deployAppService`
7. `inspectAppService` post-deploy readback

`destroy` is an explicit operation. It calls `destroyAppService` and then lists projects/services to confirm absence. `injectSecrets` never destroys a service.

## Local verification

The fixture replaces `fetch` in process and never contacts a VPS:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run contract:fixture
```

## Remote homologation (not run here)

The opt-in script uses only runtime variables and refuses to destroy a service that existed before the test. It executes pre-check, create, creation readback, marker-only env update, inspect/readback, deploy, list/get action, destroy, and post-destroy readback. It prints sanitized status lines only:

```bash
EASYPANEL_API_URL=https://easypanel.example/api \
EASYPANEL_API_TOKEN="$EASYPANEL_API_TOKEN" \
EASYPANEL_PROJECT_NAME=projetos \
EASYPANEL_HOMOLOGATION_NAMESPACE=homologation/unique-service \
npm run easypanel:homologation
```

Do not place a token in source, shell history, documentation, or output. Remote homologation was not executed as part of local verification.
