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

function tableList(projectType: ProjectRow['business_type']) {
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

function buildPayloadExample(project: ProjectRow) {
  return {
    publication: {
      project_slug: project.slug,
      project_name: project.name,
      schema_name: project.schema_name,
      template_key: project.template_key,
      domain: project.domain,
      language: project.language,
    },
    article: {
      id: 'uuid',
      slug: 'article-slug',
      title: 'Titulo do artigo',
      excerpt: 'Resumo curto',
      content: 'Conteudo em markdown ou html',
      image_url: 'https://cdn.exemplo.com/capa.jpg',
      description: 'Descricao rapida do artigo',
      prompt_image: 'Prompt usado para gerar a imagem',
      search_terms: 'termo 1, termo 2, termo 3',
      status: 'draft | scheduled | published',
      published_at: '2026-07-17T00:00:00.000Z',
      author: {
        id: 'uuid',
        name: 'Nome do autor',
      },
      category: {
        id: 'uuid',
        name: 'Categoria',
        slug: 'categoria',
      },
      seo: {
        title: 'SEO title',
        description: 'SEO description',
        canonical_url: `https://${project.domain ?? 'dominio-do-projeto'}/artigos/article-slug`,
        og_title: 'OG title',
        og_description: 'OG description',
      },
      media: {
        cover_image_url: 'https://cdn.exemplo.com/capa.jpg',
        alt_text: 'Texto alternativo',
      },
      tags: ['tag-1', 'tag-2'],
      language: project.language,
    },
  }
}

function buildDoc(project: ProjectRow) {
  const tables = tableList(project.business_type).join('\n- ')
  const payload = JSON.stringify(buildPayloadExample(project), null, 2)
  const namespace = `fbr/blogs/${project.id}`
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'https://supabase-control-tower-api.fbr.news'

  return `# Handoff BigWriter - ${project.name}

## 1. Objetivo

Entregar ao agente/desenvolvedor do **BigWriter** os parâmetros e contrato de saída exatos para gerar e publicar artigos isolados neste projeto.
Este documento atua como contrato formal de integração editorial.

---

## 2. Identidade do Projeto

- **Nome:** ${project.name}
- **Project ID (UUID):** \`${project.id}\`
- **Slug:** \`${project.slug}\`
- **Tipo de Negócio:** \`${project.business_type}\`
- **Template Base:** \`${project.template_key}\` (v${project.template_version})
- **Schema Provisionado (Isolamento):** \`${project.schema_name}\`
- **Domínio Oficial:** \`${project.domain ?? 'não configurado'}\`
- **Idioma:** \`${project.language}\`
- **Status:** \`${project.status}\`

---

## 3. Variáveis de Integração (.env.example)

> [!NOTE]
> Os agentes editoriais operam em escopo delimitado e nunca recebem chaves com privilégios de governança global.

\`\`\`env
# Identificação do Projeto
NEXT_PUBLIC_APP_NAME="${project.name}"
CONTROL_TOWER_PROJECT_ID=${project.id}
CONTROL_TOWER_SCHEMA_NAME=${project.schema_name}

# Conexão PostgREST / Supabase
SUPABASE_URL=${supabaseUrl}
SUPABASE_SERVICE_ROLE_KEY=<secret-manager:${namespace}/SUPABASE_SERVICE_ROLE_KEY>
\`\`\`

---

## 4. Regras de Integração Editorial

1. **Isolamento Estrito:** Toda inserção de artigos, categorias, autores, tags e mídias deve ser direcionada para o schema \`${project.schema_name}\`.
2. **URLs Canônicas:** Utilizar o domínio oficial \`${project.domain ?? 'dominio-do-projeto'}\` para compor as URLs canônicas e tags de OpenGraph.
3. **Catálogo Central Protegido:** Nunca consultar ou alterar tabelas do schema \`public\` (\`projects\`, \`organizations\`, etc.).
4. **Governança:** Caso seja necessário criar novas colunas para campos customizados de IA (ex: \`ai_summary\`, \`reading_time\`), execute o script SQL via Control Tower dentro do schema \`${project.schema_name}\`.

## 5. Tabelas esperadas no schema

- ${tables}

## 6. Estrutura de dados esperada para gerar artigos

O BigWriter deve devolver dados em formato estruturado, com foco em:

- titulo
- slug
- resumo
- conteudo
- image_url
- description
- prompt_image
- search_terms
- status editorial
- data de publicacao
- autor
- categoria
- tags
- SEO
- midia de capa
- idioma

### Exemplo de payload

\`\`\`json
${payload}
\`\`\`

## 7. Regras para personalizacao do schema

1. Confirmar que a mudanca e especifica desta publicacao.
2. Identificar o \`schema_name\` correto.
3. Preparar o SQL apenas para esse schema.
4. Executar o script no Editor SQL do Control Tower.
5. Validar o resultado sem tocar em \`public\`.
6. Se a mudanca for global, voltar para a modelagem central antes de aplicar.

Exemplo:

\`\`\`sql
alter table ${project.schema_name}.articles
  add column if not exists image_url text,
  add column if not exists description text,
  add column if not exists prompt_image text,
  add column if not exists search_terms text;
\`\`\`

Exemplo de ajuste em uma coluna especifica:

\`\`\`sql
alter table ${project.schema_name}.articles
  add column if not exists ai_summary text;
\`\`\`

## 8. Fluxo esperado de integracao

1. Ler os parametros do projeto no Control Tower.
2. Configurar o blog com o schema provisionado.
3. Informar as variaveis apenas pelo usuario e na aba "Enviroment" do Easypanel.
4. O BigWriter gera os artigos respeitando o contrato de saida.
5. O blog consome os dados e publica somente o que estiver dentro do schema do projeto.
6. Se houver necessidade de extensao de modelo, executar o SQL no schema correto.

## 9. Checklist para o dev

- [ ] O projeto correto foi identificado.
- [ ] O \`schema_name\` foi aplicado.
- [ ] O \`template_key\` foi respeitado.
- [ ] O \`NEXT_PUBLIC_APP_NAME\` foi ajustado para o nome da publicacao.
- [ ] A chave de servico ficou apenas no Easypanel.
- [ ] Nenhuma tabela de \`public\` foi alterada.
- [ ] O payload de artigos segue o contrato esperado.
- [ ] Qualquer extensao de schema foi executada no Editor SQL correto.

## 10. SQL de conferencia

\`\`\`sql
select id, name, slug, business_type, template_key, schema_name, domain, status, template_version
from public.projects
where slug = '${project.slug}';
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
    return NextResponse.json({ error: 'Projeto nao encontrado' }, { status: 404 })
  }

  const markdown = buildDoc(data as ProjectRow)
  return new NextResponse(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}-bigwriter-handoff.md"`,
    },
  })
}
