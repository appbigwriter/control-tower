import { NextRequest, NextResponse } from 'next/server'

import { createServiceRoleClient } from '@/lib/supabase/service'

type ProjectRow = {
  id: string
  name: string
  slug: string
  business_type: 'blog' | 'store' | 'saas' | 'custom'
  template_key: string
  schema_name: string
  domain: string | null
  status: 'pending' | 'active' | 'archived' | 'error'
  template_version: string
  language: string
  created_at: string
}

function tablesByType(projectType: ProjectRow['business_type']) {
  switch (projectType) {
    case 'blog':
      return [
        'users',
        'categories',
        'authors',
        'tags',
        'articles',
        'article_tags',
        'media_assets',
        'seo_pages',
        'redirects',
        'settings',
      ]
    case 'store':
      return [
        'categories',
        'products',
        'product_images',
        'variants',
        'orders',
        'order_items',
        'customers',
        'inventory_movements',
        'settings',
      ]
    case 'saas':
      return [
        'organizations',
        'workspaces',
        'workspace_members',
        'plans',
        'subscriptions',
        'subscription_items',
        'billing_accounts',
        'invoices',
        'usage_events',
        'feature_flags',
        'api_keys',
        'notifications',
        'settings',
      ]
    default:
      return ['entities', 'entity_relations', 'records', 'files', 'settings', 'audit_logs', 'events']
  }
}

function buildDoc(project: ProjectRow) {
  const appName = project.name
  const namespace = `fbr/blogs/${project.id}`
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'https://supabase-control-tower-api.fbr.news'

  const envBlock = [
    '# =========================================================================',
    '# 1. VARIÁVEIS PÚBLICAS (Frontend / Client-Side)',
    '# Podem ser expostas no bundle do browser com prefixo NEXT_PUBLIC_',
    '# =========================================================================',
    `NEXT_PUBLIC_APP_NAME="${appName}"`,
    `NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=<secret-manager:${namespace}/NEXT_PUBLIC_SUPABASE_ANON_KEY>`,
    '',
    '# =========================================================================',
    '# 2. VARIÁVEIS PRIVADAS DE RUNTIME (Backend / Workers / Servidor)',
    '# Injetar EXCLUSIVAMENTE na aba Environment do Easypanel / Secret Manager.',
    '# NUNCA comitar no Git, NUNCA expor no Frontend, NUNCA colar em chat/logs.',
    '# =========================================================================',
    `SUPABASE_URL=${supabaseUrl}`,
    `SUPABASE_SERVICE_ROLE_KEY=<secret-manager:${namespace}/SUPABASE_SERVICE_ROLE_KEY>`,
    `CONTROL_TOWER_PROJECT_ID=${project.id}`,
    `CONTROL_TOWER_SCHEMA_NAME=${project.schema_name}`,
  ].join('\n')

  const tables = tablesByType(project.business_type).join('\n- ')

  return `# Documentação de Integração Técnica - ${project.name}

## 1. Identidade e Governança do Projeto

- **Nome da Aplicação:** ${project.name}
- **Project ID (UUID):** \`${project.id}\`
- **Slug:** \`${project.slug}\`
- **Tipo de Negócio:** \`${project.business_type}\`
- **Template Base:** \`${project.template_key}\` (v${project.template_version})
- **Schema Provisionado (Isolamento):** \`${project.schema_name}\`
- **Domínio Oficial:** \`${project.domain ?? 'não configurado'}\`
- **Idioma:** \`${project.language}\`
- **Status:** \`${project.status}\`
- **Namespace de Secrets:** \`${namespace}/\`

---

## 2. Política de Secrets e Injeção de Variáveis

> [!IMPORTANT]
> **Princípio Zero Secret Leaks:** O Control Tower e os documentos de handoff **nunca contêm valores reais de chaves privadas** (como a \`SUPABASE_SERVICE_ROLE_KEY\`). O documento entrega referências e especificações para injeção segura no runtime.

### Onde configurar as variáveis:
1. **Ambiente Local de Desenvolvimento:** Crie um arquivo \`.env.local\` (garantido no \`.gitignore\`) substituindo as referências pelas credenciais do seu ambiente de teste.
2. **Ambiente de Produção (Easypanel):** Acesse a aplicação no painel do Easypanel $\\rightarrow$ aba **Environment** $\\rightarrow$ insira os valores reais ou vincule o Secret Manager do namespace \`${namespace}\`.

---

## 3. Modelo de Variáveis (.env.example)

\`\`\`env
${envBlock}
\`\`\`

---

## 4. Regras de Arquitetura e Isolamento

1. **Isolamento por Schema:** Todo o código da aplicação deve operar exclusivamente dentro do schema \`${project.schema_name}\`.
2. **Catálogo Central (\`public\`):** As tabelas no schema \`public\` pertencem à governança central do Control Tower. O blog/sistema **NUNCA** deve criar, alterar ou excluir tabelas em \`public\`.
3. **Chave de Serviço:** A \`SUPABASE_SERVICE_ROLE_KEY\` possui permissões administrativas e **jamais** deve ser acessível pelo código do cliente/frontend (browser).
4. **Evolução de Estrutura:** Se o projeto necessitar de novas tabelas ou colunas específicas, aplique o SQL no schema \`${project.schema_name}\` via Editor SQL do Control Tower.

---

## 5. Tabelas Provisionadas no Schema \`${project.schema_name}\`

- ${tables}

---

## 6. Exemplo de Customização Segura de Schema

Caso precise adicionar campos específicos ao seu projeto:

\`\`\`sql
-- Executar via Control Tower apontando para o schema do projeto:
alter table ${project.schema_name}.articles
  add column if not exists custom_notes text;
\`\`\`

---

## 7. Checklist de Validação do Desenvolvedor

- [ ] Arquivo \`.env.local\` configurado localmente e presente no \`.gitignore\`.
- [ ] No Easypanel, as variáveis privadas foram salvas na aba **Environment**.
- [ ] O frontend utiliza apenas variáveis com prefixo \`NEXT_PUBLIC_\`.
- [ ] As consultas Supabase especificam o schema \`${project.schema_name}\`.
- [ ] Nenhuma query afeta ou consulta tabelas do schema \`public\`.
- [ ] O health check da aplicação respondeu com sucesso (HTTP 200).

---

## 8. Query de Conferência Cadastral

\`\`\`sql
select id, name, slug, business_type, template_key, schema_name, domain, status, template_version
from public.projects
where id = '${project.id}';
\`\`\`
`
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const supabase = createServiceRoleClient()

  const { data, error } = await supabase
    .from('projects')
    .select(
      'id, name, slug, business_type, template_key, schema_name, domain, status, template_version, language, created_at',
    )
    .eq('slug', slug)
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ error: 'Projeto não encontrado' }, { status: 404 })
  }

  const markdown = buildDoc(data as ProjectRow)
  return new NextResponse(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}-dev-doc.md"`,
    },
  })
}
