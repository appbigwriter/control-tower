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

  return `# Handoff BigWriter - ${project.name}

## 1. Objetivo

Entregar ao dev do BigWriter os parametros exatos para gerar artigos e integrar a publicacao a este projeto.
Este documento deve ser usado como contrato de integracao do gerador de textos.

## 2. Identidade do projeto

- Nome: ${project.name}
- Slug: ${project.slug}
- Tipo: ${project.business_type}
- Template: ${project.template_key}
- Versao do template: ${project.template_version}
- Schema provisionado: ${project.schema_name}
- Dominio: ${project.domain ?? 'nao definido'}
- Idioma: ${project.language}
- Status: ${project.status}

## 3. Variaveis de ambiente

Crie um documento .env.exemple com as variaveis que vai precisar que o usuario informe e acrescente as abaixo:

\`\`\`env
NEXT_PUBLIC_APP_NAME=${project.name}
SUPABASE_URL=<supabase-url-do-ambiente>
SUPABASE_SERVICE_ROLE_KEY=<chave-do-servico-no-Easypanel>
NEXT_PUBLIC_SUPABASE_URL=<supabase-url-do-ambiente>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
\`\`\`

## 4. Regras de integracao

- O projeto usa \`schema_name\` como isolamento de dados.
- O \`template_key\` define o formato e o contrato de saida esperado.
- O \`domain\` ja esta provisionado no cadastro do projeto e deve ser usado nas URLs canonicas.
- O \`NEXT_PUBLIC_APP_NAME\` deve ser o nome da publicacao.
- A \`SUPABASE_SERVICE_ROLE_KEY\` fica no servico do blog dentro do Easypanel e nao deve ir para o cliente.
- As tabelas do schema \`public\` sao centralizadas e nao podem ser alteradas pelo dev do BigWriter.
- Toda personalizacao de estrutura deve acontecer apenas no \`schema_name\` deste projeto.
- Se precisar adicionar colunas, tabelas, relacoes ou indices, use o Editor SQL do Control Tower no projeto correto.
- Nunca rode alteracoes em \`public\` a partir do blog, do gerador ou do front.

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
