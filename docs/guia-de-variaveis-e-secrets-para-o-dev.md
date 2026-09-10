# Guia do Desenvolvedor: Padrão Seguro de Variáveis e Secrets (Control Tower & Easypanel)

> **Destinatário:** Time de Desenvolvimento / Engenharia de Aplicação  
> **Origem:** Control Tower / GestaoDB  
> **Status:** Ativo / Padrão Obrigatório  
> **Referências:** `03-arquitetura/metodo-seguro-de-secrets.md` e `05-workflows/provisionamento-blog.md`

---

## 1. Visão Geral e Princípio "Zero Secret Leaks"

Para eliminar vulnerabilidades de segurança e vazamentos acidentais de chaves mestras no Git, nos logs, no frontend ou nos prompts de agentes de IA, o ecossistema FBR adotou o princípio de **distribuição de referências e injeção em runtime**.

### O que mudou:
- **O Control Tower não entrega chaves privadas em texto puro.** Os documentos de handoff (`developer-doc.md`, `bigwriter-handoff.md`, etc.) agora contêm esquemas estruturados (`.env.example`) com **placeholders e referências de namespace**.
- **Cada projeto possui um Namespace Imutável** baseado em seu UUID cadastrado no Control Tower:
  ```text
  fbr/blogs/<PROJECT_ID>/
  ```

---

## 2. Classificação e Destino das Variáveis

As variáveis de cada aplicação (Blog, Store, SaaS) são divididas estritamente em duas categorias:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. PÚBLICAS (Frontend / Browser)                                            │
│    Prefixo: NEXT_PUBLIC_*                                                   │
│    Visibilidade: Embutidas no bundle JavaScript do Next.js                  │
│    Exemplos: NEXT_PUBLIC_APP_NAME, NEXT_PUBLIC_SUPABASE_URL                │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. PRIVADAS (Runtime / Backend / Workers)                                   │
│    Sem prefixo público. NUNCA referenciadas no código do cliente (browser)   │
│    Visibilidade: Apenas no processo Node.js/Server-Side                     │
│    Onde configurar: Aba "Environment" do Easypanel / Secret Manager         │
│    Exemplos: SUPABASE_SERVICE_ROLE_KEY, CONTROL_TOWER_API_KEY              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Modelo Padrão de `.env.example` Gerado pelo Control Tower

Ao provisionar um novo projeto e baixar o `developer-doc.md`, o desenvolvedor receberá o seguinte template pronto:

```env
# =========================================================================
# 1. VARIÁVEIS PÚBLICAS (Frontend / Client-Side)
# Podem ser expostas no bundle do browser com prefixo NEXT_PUBLIC_
# =========================================================================
NEXT_PUBLIC_APP_NAME="Portal Exemplo"
NEXT_PUBLIC_SUPABASE_URL=https://supabase-control-tower-api.fbr.news
NEXT_PUBLIC_SUPABASE_ANON_KEY=<secret-manager:fbr/blogs/<PROJECT_ID>/NEXT_PUBLIC_SUPABASE_ANON_KEY>

# =========================================================================
# 2. VARIÁVEIS PRIVADAS DE RUNTIME (Backend / Workers / Servidor)
# Injetar EXCLUSIVAMENTE na aba Environment do Easypanel / Secret Manager.
# NUNCA comitar no Git, NUNCA expor no Frontend, NUNCA colar em chat/logs.
# =========================================================================
SUPABASE_URL=https://supabase-control-tower-api.fbr.news
SUPABASE_SERVICE_ROLE_KEY=<secret-manager:fbr/blogs/<PROJECT_ID>/SUPABASE_SERVICE_ROLE_KEY>
CONTROL_TOWER_PROJECT_ID=<PROJECT_ID>
CONTROL_TOWER_SCHEMA_NAME=blog_portalexemplo
```

---

## 4. Passo a Passo do Desenvolvedor

### A. Desenvolvimento Local (`localhost`)
1. Copie o `.env.example` para `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
2. No `.env.local`, preencha os valores reais de desenvolvimento.
3. **Verificação Crítica:** Certifique-se de que o `.gitignore` contenha:
   ```gitignore
   .env*.local
   .env
   *.env
   ```

### B. Deploy e Produção no Easypanel
1. Acesse o **Easypanel** no serviço correspondente ao blog/projeto.
2. Navegue até a aba **Environment** (Variáveis de Ambiente).
3. Insira as variáveis públicas e privadas com seus valores reais de produção (ou associe o Secret Manager do namespace `fbr/blogs/<PROJECT_ID>`).
4. Salve e execute o **Deploy / Restart**.
5. O Easypanel injetará as variáveis diretamente no processo Docker em runtime, mantendo o repositório Git 100% limpo e seguro.

---

## 5. Regras de Isolamento Multi-Tenant por Schema

1. **Acesso por Schema:** O banco Supabase central é multi-tenant. Cada blog possui seu próprio schema isolado (ex: `blog_portalexemplo`).
2. **Consultas Supabase:** Toda query via cliente Supabase backend deve apontar para o schema do projeto:
   ```typescript
   import { createClient } from '@supabase/supabase-js'

   // Backend / Server Actions
   const supabase = createClient(
     process.env.SUPABASE_URL!,
     process.env.SUPABASE_SERVICE_ROLE_KEY!,
     {
       db: { schema: process.env.CONTROL_TOWER_SCHEMA_NAME } // ex: blog_portalexemplo
     }
   )
   ```
3. **Schema `public` é Restrito:** Nenhuma aplicação deve executar `CREATE TABLE`, `ALTER TABLE` ou `DELETE` no schema `public`. Mudanças de governança ocorrem apenas pelo Control Tower.

---

## 6. Checklist de Validação para Entrega

- [ ] Todas as chamadas do cliente (browser) usam apenas variáveis `NEXT_PUBLIC_*`.
- [ ] A chave `SUPABASE_SERVICE_ROLE_KEY` é usada unicamente em rotas de API/Server Actions protegidas.
- [ ] No Easypanel, a aba **Environment** foi preenchida com as credenciais do projeto.
- [ ] O repositório Git foi inspecionado e não contém nenhum arquivo `.env` com chaves reais comitadas.
- [ ] O Health check (`GET /api/health` ou carregamento da Home) retornou HTTP 200 conectando no schema dedicado.
