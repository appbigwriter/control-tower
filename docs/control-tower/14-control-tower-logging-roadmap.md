# Control Tower - Logging Roadmap

## Objetivo

Definir os logs específicos que devem ser adicionados em uma próxima rodada de evolução do GestaoDB / Control Tower.

## Escopo

Esta etapa não altera a versão atual de produção. Serve apenas como plano técnico para a próxima vez que mexermos no projeto.

## Princípios

- Registrar eventos relevantes para auditoria e operação.
- Separar logs operacionais de logs de segurança.
- Manter os logs vinculados ao projeto sempre que houver contexto.
- Evitar poluição de `public` com dados que pertençam ao domínio de operação.

## Eventos obrigatórios

### 1. Autenticação do Control Tower

- login realizado
- login falhou
- logout realizado
- sessão expirada

### 2. Operações de projeto

- projeto provisionado
- projeto provisionamento falhou
- projeto arquivado
- projeto reexecutado
- projeto atualizado manualmente

### 3. Editor SQL

- abertura do editor SQL
- execução de SQL iniciada
- execução de SQL concluída com sucesso
- execução de SQL falhou
- usuário responsável pela execução

### 4. Documentação para dev

- geração do documento do projeto
- download do documento
- geração falhou

## Eventos opcionais

- consulta ao dashboard por projeto
- carregamento de métricas
- acesso à página de detalhe do projeto
- acesso à página de jobs
- acesso à página de templates

## Modelo mínimo de payload

Todo log deve carregar, quando aplicável:

- `event_name`
- `project_id`
- `project_slug`
- `schema_name`
- `actor_user_id`
- `actor_email`
- `source`
- `success`
- `message`
- `metadata`
- `created_at`

## Tabelas sugeridas

### `audit_logs`

Usar para eventos administrativos e de governança.

### `provisioning_jobs`

Usar para estados operacionais do provisionamento e rebuild.

### `security_logs`

Criar em uma próxima rodada para autenticação, acesso e ações sensíveis.

### `sql_execution_logs`

Criar em uma próxima rodada para registrar uso do Editor SQL.

## Regras por área

### Control Tower

- tudo que for ação administrativa deve gerar auditoria
- mudanças de estado devem gerar job e log

### Blog / projeto provisionado

- manter logs do projeto separados dos logs do catálogo central
- registrar apenas eventos relevantes ao domínio daquele projeto

### Editor SQL

- registrar sempre quem executou
- registrar o schema alvo
- registrar sucesso ou falha
- registrar o SQL apenas se a política de segurança permitir

## Ordem sugerida de implementação

1. criar tabela `security_logs`
2. criar tabela `sql_execution_logs`
3. padronizar inserts em `audit_logs`
4. instrumentar login/logout
5. instrumentar Editor SQL
6. instrumentar geração de documentação
7. instrumentar mudanças manuais de projeto

## Observações

- Logs não substituem jobs.
- Jobs não substituem auditoria.
- O ideal é que cada ação relevante gere o evento correto nas duas camadas quando necessário.

## Critério de pronto

O item estará pronto quando:

- login/logout estiverem logados
- provisionamento estiver auditado
- Editor SQL estiver rastreável
- geração de documentação estiver registrada
- o projeto puder ser investigado por histórico

