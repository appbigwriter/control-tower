# Incidente Easypanel — getAction sem arquivo de log

## Evidência

Durante a homologação remota autorizada do serviço temporário `projetos/flux-connection-test`, o Easypanel respondeu:

```json
{"http":400,"code":"BAD_REQUEST","message":"ENOENT: no such file or directory, open '/etc/easypanel/actions/cmtzazca1000707o6h5lu57st.log'","status":"[object]"}
```

## Interpretação

O endpoint `listActions` retornou o registro da ação com ID `cmtzazca1000707o6h5lu57st`, mas `getAction?id=cmtzazca1000707o6h5lu57st` tentou abrir um arquivo de log inexistente em `/etc/easypanel/actions/`

Isso indica que o registro da ação e seu arquivo de log não estão sendo mantidos de forma consistente pela instalação Easypanel v2.34.0

## O que foi comprovado

- autenticação Bearer: aprovada
- API REST: acessível
- `createAppService`: HTTP 200 e readback `CONFIRMED`
- `updateAppEnv`: HTTP 200 e readback `CONFIRMED`
- `deployAppService`: HTTP 200 e readback recebido
- `listActions`: HTTP 200 e registros encontrados
- `destroyAppService`: HTTP 200
- readback pós-destruição: `ABSENT_CONFIRMED`
- `getAction`: HTTP 400 por arquivo de log ausente

## Classificação

```text
HOMOLOGATION_PARTIAL_GETACTION_LOG_MISSING
```

Não declarar homologação 100% concluída enquanto `getAction` continuar documentado, mas não conseguir ler os logs das ações retornadas por `listActions`

## Limite de segurança

Não tentar criar, copiar ou editar arquivos em `/etc/easypanel/actions/` por fora do Easypanel. Não alterar banco interno, não fabricar log e não transformar `listActions` em prova de conteúdo do log

## Próximas ações

1. consultar a política de retenção/limpeza de actions da instalação
2. verificar se `getAction` funciona para uma ação recém-finalizada antes de qualquer limpeza automática
3. consultar logs do serviço Easypanel sem expor secrets
4. verificar permissões e montagem do diretório `/etc/easypanel/actions/`
5. confirmar se a versão `2.34.0` possui bug conhecido ou configuração de storage necessária
6. manter `listActions` como readback de metadados, não de log detalhado
7. atualizar o adapter para registrar `NOT_VERIFIED/GET_ACTION_LOG_MISSING` sem fingir conteúdo

## Estado do recurso de teste

O serviço temporário foi removido e o readback pós-destruição confirmou sua ausência. Nenhum recurso temporário ficou pendente
