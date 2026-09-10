# GestaoDB / Control Tower - Referência de API e Schemas

## 1. Mapeamento de Templates de Banco de Dados

| `business_type` | `template_key` | Prefixo do Schema | Tabelas Inclusas |
|---|---|---|---|
| `blog` | `blog_standard` | `blog_<slug>` | `users`, `categories`, `authors`, `tags`, `articles`, `article_tags`, `media_assets`, `seo_pages`, `redirects`, `settings` |
| `store` | `store_standard` | `store_<slug>` | `customers`, `products`, `categories`, `orders`, `order_items`, `inventory`, `coupons`, `shipping_methods`, `settings` |
| `saas` | `saas_standard` | `saas_<slug>` | `organizations`, `workspaces`, `workspace_members`, `plans`, `subscriptions`, `subscription_items`, `billing_accounts`, `invoices`, `usage_events`, `feature_flags`, `api_keys`, `notifications`, `settings` |
| `custom` | `custom_base` | `custom_<slug>` | `audit_logs`, `settings` |

---

## 2. Resumo de Endpoints REST

| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/api/control-tower/projects` | Lista todos os projetos do catálogo. |
| `POST` | `/api/control-tower/projects` | Provisiona um novo banco de dados. |
| `DELETE` | `/api/control-tower/projects/[slug]` | Exclui o projeto e dropa o schema com `CASCADE`. |
| `POST` | `/api/control-tower/projects/[slug]/actions` | Executa ações (`rebuild` de schema ou `archive`). |
| `POST` | `/api/control-tower/projects/[slug]/sql` | Executa queries SQL diretamente no schema do projeto. |
| `GET` | `/api/control-tower/projects/[slug]/developer-doc` | Gera documento de integração técnica para o desenvolvedor. |
| `GET` | `/api/control-tower/projects/[slug]/bigwriter-handoff` | Gera documento de handoff para o agente editorial BigWriter. |
| `GET` | `/api/control-tower/projects/[slug]/frontend-adsense-handoff` | Gera documento de handoff de frontend, layout e AdSense. |
