# Inventário e plano de migração do Hermes para a VPS

**Data da coleta:** 2026-09-10 07:42:57 -03:00  
**Origem:** Windows local, `C:/Users/OEM/AppData/Local/hermes`  
**Status:** inventário local concluído; inventário da VPS pendente de execução no servidor; migração ainda não executada

## 1. Decisão arquitetural recomendada

Migrar o **Gateway e os perfis dos Bots para a VPS**, mantendo o Hermes Desktop nesta máquina como interface remota.

```text
Windows local
└── Hermes Desktop
    └── conexão remota segura
        └── Hermes Gateway na VPS
            ├── perfil default + Bots
            ├── skills, memória e sessões
            ├── Cron / rotinas
            ├── MCPs e integrações
            ├── GestaoDB / Control Tower
            └── aplicações e automações
```

Não haverá dois Gateways ativos usando os mesmos canais. Durante o cutover, o Gateway local será pausado e mantido como rollback.

## 2. Inventário local confirmado

### 2.1 Runtime

| Item | Estado confirmado |
|---|---|
| Hermes | `v0.21.0 (2026.8.31)` |
| upstream | `a0749d58` |
| alteração local | `7840a0e2 (+1 carried commit)` |
| instalação | Git em `C:/Users/OEM/AppData/Local/hermes/hermes-agent` |
| Python | `3.11.9` |
| OpenAI SDK | `2.24.0` |
| config | versão `v40`, sem chaves depreciadas |
| Gateway local | em execução no momento do inventário |
| SQLite | `3.45.1`; doctor alerta bug WAL conhecido |
| sistema | Windows 11 |

### 2.2 Diretórios Hermes

Diretório efetivo detectado:

```text
C:/Users/OEM/AppData/Local/hermes
```

`C:/Users/OEM/.hermes` existe, mas contém apenas uma estrutura antiga/parcial (`skills` e `whatsapp`). Não deve ser tratado como origem principal.

Itens críticos detectados no diretório efetivo:

```text
config.yaml
.env
auth.json
state.db
sessions/
profiles/
skills/
cron/
logs/
memories/
SOUL.md
kanban.db
kanban/
projects.db
verification_evidence.db
mcp-tokens/
platforms/
plugins/
gateway-service/
```

Tamanho aproximado total do diretório efetivo: **3.155.140.858 bytes**, em aproximadamente **34.683 arquivos**. Esse volume inclui caches, anexos, logs e artefatos; a migração deverá separar dados essenciais de cache regenerável.

### 2.3 Perfis / Bots

Foram encontrados **13 perfis operacionais** e uma pasta `.deleted` com perfis removidos:

| Perfil | Modelo | Estado no inventário |
|---|---|---|
| `default` | `gpt-4o-mini` | Gateway running |
| `amazonlisting` | `gpt-5.6-luna` | stopped |
| `amazonqa` | `gpt-5.6-luna` | stopped |
| `amazonresearch` | `gpt-5.6-luna` | stopped |
| `caio` | `gpt-5.6-luna` | stopped |
| `duda` | `gpt-5.6-luna` | stopped |
| `emailguardian` | `gpt-4o-mini` | stopped |
| `iris` | `gpt-5.6-luna` | stopped |
| `kora` | `gpt-5.6-luna` | stopped |
| `lia` | `gpt-5.6-luna` | stopped |
| `rafa` | `gpt-5.6-luna` | stopped |
| `secondbrain` | `gpt-4o-mini` | stopped |
| `theo` | `gpt-5.6-luna` | stopped |
| `vito` | `gpt-5.6-luna` | stopped |
| `.deleted` | `amazoncreative`, `amazonppc` | arquivo lógico; não reativar sem decisão |

Cada perfil possui, conforme o caso, `SOUL.md`, `USER.md`, `MEMORY.md`, `config.yaml`, `profile.yaml`, `state.db`, `projects.db`, avatar, caches e cron próprio.

### 2.4 Skills

A instalação contém as famílias de skills:

```text
apple
autonomous-ai-agents
creative
devops
ecommerce
email
gestaodb-control-tower
github
hermes-administration
infrastructure
maestro
mastertraffic
media
mlops
note-taking
productivity
research
sergio-workflow
smart-home
social-media
software-development
tina
web
```

Também existem `.hub` e `.curator_backups`. A skill personalizada `gestaodb-control-tower` está instalada no Hermes global e deve ser incluída na migração.

### 2.5 Memória e sessões

O doctor confirmou:

- `state.db`: aproximadamente **120,1 MB**
- **11.333 mensagens**
- **116 sessões**
- FTS ativo (`messages_fts`, `messages_fts_trigram`)
- `MEMORY.md`: 2.199 caracteres
- `USER.md`: 1.135 caracteres
- diretório `memories/` presente

A migração deve copiar os bancos SQLite somente com Hermes parado e com backup consistente. Não copiar `state.db` enquanto houver escrita ativa.

### 2.6 Cron / rotinas

Foram confirmadas **3 rotinas ativas**:

| ID | Nome | Frequência | Destino | Situação |
|---|---|---|---|---|
| `30f08eefde93` | `tina-tiroteio` | a cada 60 min | Telegram `861952660` | bloqueada por drift de provider/modelo; 184 falhas consecutivas |
| `886941fcd3f0` | `Lembrete diário — Maestro e PreListing` | diariamente às 09:00 | `all` | drift de provider/modelo e falha de destino `all` |
| `bc56f02e853f` | `Second Brain — indexação segura` | a cada 360 min | Bot Chat `secondbrain` | última execução interrompida por shutdown |

**Importante:** a migração não deve replicar cegamente essas falhas. Antes ou durante a homologação, será necessário fixar explicitamente provider/modelo das duas primeiras rotinas e revisar o destino `all`.

Os arquivos de definição estão em:

```text
C:/Users/OEM/AppData/Local/hermes/cron/jobs.json
```

### 2.7 Canais, MCPs e plugins

Detectado no config e filesystem:

- Telegram habilitado
- WhatsApp habilitado
- Slack habilitado
- MCP Firecrawl configurado
- MCP Canva configurado
- tokens MCP armazenados em `mcp-tokens/`
- plugin `humalike`
- `desktop-plugins/` vazio
- `platforms/pairing/` presente
- `gateway-service/` com scripts Windows (`Hermes_Gateway.cmd`, `Hermes_Gateway.vbs`)
- `discord.py` não instalado; Discord não está operacional
- ferramentas `browser`, `browser-cdp`, `computer_use` e `a2a` não estão disponíveis neste ambiente
- Playwright Chromium instalado; `agent-browser` resolve via npx

### 2.8 Modelos, providers e autenticação

O sistema possui configuração de modelo padrão, aliases, custom provider, fallback models e modelos de referência MoA. Os valores sensíveis não foram exibidos neste relatório.

O doctor confirmou:

- OpenAI Codex autenticado
- Nous Portal não autenticado
- MiniMax OAuth não autenticado
- xAI OAuth não autenticado
- API/custom endpoint configurado
- OpenRouter, Z.AI/GLM e NVIDIA NIM com conectividade aprovada

A VPS deverá receber os segredos por canal seguro, nunca por commit, chat ou arquivo público. `auth.json`, `.env`, tokens MCP e credenciais de canais devem ser tratados como secretos.

### 2.9 Saúde encontrada

`hermes doctor` retornou código 0, mas registrou pendências:

1. SQLite `3.45.1` com alerta de bug WAL; atualizar Hermes/runtime na VPS para SQLite corrigido
2. duas áreas com vulnerabilidades npm de dependências de build/browser
3. API keys ausentes para ferramentas opcionais
4. jobs com drift de provider/modelo
5. destino `all` sem resolução em uma rotina
6. última indexação do Second Brain interrompida por shutdown
7. Hermes local está **5.991 commits atrás** do upstream; não atualizar automaticamente durante a migração sem congelar a versão de origem

## 3. Inventário da VPS que ainda precisa ser coletado

Não é possível declarar a VPS pronta sem executar os seguintes checks no próprio servidor:

```bash
hostnamectl
uname -a
cat /etc/os-release
free -h
df -h
nproc
python3 --version
node --version
npm --version
docker --version
hermes --version || true
hermes doctor || true
systemctl --type=service --state=running
ss -lntup
```

Também devem ser levantados:

- IP público e IP Tailscale
- usuário de deploy e método SSH
- firewall/UFW e portas abertas
- Docker/Easypanel/Caddy existentes
- domínio e TLS do Gateway
- método de persistência do serviço (`systemd` recomendado)
- volumes e backups da VPS
- localização de `GestaoDB`, n8n, MinIO, Mailcow e demais sistemas
- versão de PostgreSQL/Supabase
- conectividade com Control Tower
- capacidade livre em disco e RAM
- política de atualização e rollback
- acesso de saída HTTPS para providers
- webhook/long polling dos canais
- existência de outro Hermes Gateway na VPS

## 4. Plano detalhado de migração

### Fase 0 — Congelamento e critérios

1. Definir janela de migração sem jobs críticos.
2. Não executar `hermes update` na instalação local antes do backup.
3. Fixar a versão de origem: `v0.21.0`, commit e arquivos de configuração.
4. Registrar os três jobs ativos, perfis e canais.
5. Confirmar que nenhuma tarefa destrutiva está em andamento.
6. Definir o nome DNS ou endereço Tailscale do Gateway da VPS.

**Critério de saída:** inventário local e inventário da VPS assinados/comparados.

### Fase 1 — Backup verificável da origem

1. Parar o Gateway local e aguardar processos filhos encerrarem.
2. Fazer cópia integral de `C:/Users/OEM/AppData/Local/hermes`.
3. Excluir da cópia de trabalho apenas caches claramente regeneráveis, mantendo um backup bruto completo.
4. Gerar SHA-256 do arquivo de backup.
5. Guardar separadamente uma cópia cifrada de `.env`, `auth.json`, tokens MCP e credenciais de canais.
6. Copiar também arquivos de projetos e scripts referenciados por jobs, especialmente `index_secondbrain.py`.

**Critério de saída:** restauração local do backup abre `hermes profile list`, `hermes cron list` e `hermes doctor` sem corrupção.

### Fase 2 — Preparação da VPS

1. Atualizar o sistema operacional e instalar Python 3.11+, Git, Node.js, Docker se necessário e dependências de browser.
2. Instalar **a mesma versão** do Hermes; não usar o upstream mais recente automaticamente.
3. Criar usuário de serviço sem privilégios administrativos.
4. Criar diretório persistente do Hermes.
5. Configurar permissões, firewall e acesso exclusivamente via SSH/Tailscale.
6. Instalar GestaoDB/Control Tower e demais repositórios em caminhos Linux estáveis.
7. Substituir caminhos Windows por variáveis Linux documentadas, sem alterar lógica dos agentes.
8. Configurar serviço `systemd` com restart automático e logs persistentes.
9. Configurar backup diário do diretório Hermes e databases SQLite.
10. Instalar uma versão de SQLite sem o alerta encontrado no Windows.

**Critério de saída:** `hermes --version`, `hermes doctor` e Gateway iniciam na VPS sem erro crítico.

### Fase 3 — Importação controlada

1. Copiar `config.yaml`, `SOUL.md`, `profiles/`, `skills/`, `memories/`, `sessions/`, `state.db`, `projects.db`, `kanban/`, `cron/` e arquivos necessários.
2. Não copiar locks, PID files, sockets ou estado temporário em uso.
3. Restaurar `.env`, `auth.json` e tokens MCP pelo mecanismo seguro da VPS.
4. Revalidar providers e modelos sem alterar as preferências dos Bots.
5. Recriar somente integrações que dependem de Windows, como o script `.cmd/.vbs` do Gateway.
6. Converter scripts de Cron para caminhos Linux e testar em modo manual.
7. Configurar os canais externos somente no Gateway de homologação, evitando duplicidade de Telegram/WhatsApp/Slack.

**Critério de saída:** perfil list apresenta os mesmos 13 perfis, mesmos aliases, skills, memórias e modelos.

### Fase 4 — Homologação sem tráfego duplicado

Testar na VPS, nesta ordem:

1. iniciar e parar Gateway
2. `hermes profile list`
3. `hermes cron list`
4. abrir Bot Chat de `default`, `iris`, `secondbrain`, `amazonresearch`, `theo` e `emailguardian`
5. verificar `SOUL.md`, memória e histórico
6. executar uma consulta simples por perfil
7. testar uma skill representativa por perfil
8. testar delegação entre agentes
9. testar Kanban
10. testar MCP Firecrawl e Canva
11. testar acesso ao GestaoDB/Control Tower
12. testar `GET /api/control-tower/projects`
13. criar um projeto de teste com slug temporário, validar schema, e excluir somente após confirmação de teste
14. rodar `hermes cron run` manualmente em cópia/ambiente controlado
15. validar logs, consumo e reinício automático

Não ligar os webhooks/canais de produção antes dos testes de identidade e routing.

**Critério de saída:** todos os testes passam e não existe diferença funcional conhecida, exceto caminhos do sistema operacional.

### Fase 5 — Correção das pendências existentes

Antes do cutover, corrigir explicitamente:

- fixar provider/modelo de `tina-tiroteio`
- fixar provider/modelo do lembrete diário
- substituir destino `all` por destino explícito validado
- verificar por que a rotina Second Brain foi interrompida
- revisar o alerta SQLite
- decidir se `amazoncreative` e `amazonppc` permanecem arquivados
- confirmar quais ferramentas opcionais serão instaladas na VPS

Essas correções são pré-requisitos de confiabilidade e não devem ser confundidas com diferenças causadas pela migração.

### Fase 6 — Cutover

1. Pausar os três jobs no Gateway local.
2. Parar o Gateway local.
3. Fazer um backup final incremental.
4. Confirmar que não há processo Hermes local ativo.
5. Ativar o Gateway da VPS.
6. Ativar jobs na VPS, um por vez.
7. Conectar Hermes Desktop à VPS.
8. Validar uma mensagem por canal e uma mensagem entre Bots.
9. Confirmar que cada job executou no horário esperado.
10. Monitorar logs por no mínimo 24 horas.

**Regra:** nunca manter Telegram, WhatsApp, Slack ou outro canal conectado simultaneamente nos dois Gateways.

### Fase 7 — Pós-migração

Durante as primeiras 72 horas:

- monitorar uso de CPU, RAM, disco e rede
- verificar jobs e entregas
- verificar mensagens entre agentes
- verificar erros do Gateway
- conferir backups
- validar acesso ao Control Tower
- comparar contagem de perfis, sessões, skills e memórias
- manter a instalação local desligada, mas preservada

Após 7 dias sem regressões, decidir se o Gateway local será apenas backup frio.

## 5. Plano de rollback

Se qualquer teste crítico falhar:

1. pausar o Gateway da VPS
2. desativar canais na VPS
3. restaurar o backup final se houver alteração de dados
4. reativar o Gateway local
5. reativar jobs somente após verificar que não houve execução duplicada
6. registrar a falha e corrigir na VPS
7. repetir homologação antes de novo cutover

O rollback não deve apagar perfis, sessões ou bancos da VPS. A VPS deve ser preservada para investigação.

## 6. Critérios formais para declarar a migração concluída

A migração somente será considerada concluída quando:

- [ ] Gateway da VPS reinicia automaticamente
- [ ] Desktop conecta à VPS
- [ ] os 13 perfis aparecem
- [ ] nomes, aliases, modelos e SOULs estão preservados
- [ ] skills globais e skills por perfil estão disponíveis
- [ ] MEMORY/USER e sessões estão preservados
- [ ] canais funcionam sem duplicidade
- [ ] comunicação Bot-to-Bot funciona
- [ ] Cron executa e entrega corretamente
- [ ] Second Brain indexa sem depender de `F:` ou `C:`
- [ ] GestaoDB/Control Tower responde
- [ ] MCPs essenciais funcionam
- [ ] backups e rollback foram testados
- [ ] logs não apresentam erro crítico por 24 horas

## 7. Bloqueios atuais

A migração ainda não pode ser executada de forma responsável porque faltam:

1. acesso SSH/Tailscale à VPS
2. inventário do sistema operacional e recursos da VPS
3. confirmação do domínio/endereço do Gateway remoto
4. definição dos canais que devem permanecer ativos
5. decisão sobre atualização ou congelamento da versão Hermes
6. resolução dos três jobs atualmente problemáticos

Nenhum agente, perfil, credencial, banco ou canal foi alterado durante este inventário.
