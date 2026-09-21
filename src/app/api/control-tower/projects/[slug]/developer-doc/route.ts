import { NextRequest, NextResponse } from 'next/server'

import { createServiceRoleClient } from '@/lib/supabase/service'
import { buildNamespace, buildValidationDomain } from '@/lib/control-tower/project-configuration'

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
  authority_owner_id?: string | null
  hosting_target?: 'vps1' | 'vps2' | null
  hosting_project_name?: string | null
  repository_path?: string | null
  service_name?: string | null
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

function buildManualEnvDocument(project: ProjectRow, runtimeDocument: string): string {
  const textualValues: Record<string, string> = {
    DATABASE_URL: '<SUPABASE_CENTRAL_DATABASE_URL_ACCESSIBLE_FROM_RUNTIME>',
    SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'https://supabase-control-tower-api.fbr.news',
    SUPABASE_SERVICE_ROLE_KEY: '<SUPABASE_CENTRAL_SERVICE_ROLE_KEY>',
    CONTROL_TOWER_PROJECT_ID: project.id,
    CONTROL_TOWER_SCHEMA_NAME: project.schema_name,
    AUTHORITY_PROJECT_ID: project.id,
    AUTHORITY_OWNER_ID: project.authority_owner_id ?? '<GENERATED_STABLE_AUTHORITY_OWNER_ID>',
    AUTHORITY_ADMIN_TOKEN: '<GENERATED_AND_PERSISTED_AUTHORITY_ADMIN_TOKEN>',
    AUTHORITY_OPERATOR_TOKEN: '<GENERATED_AND_PERSISTED_AUTHORITY_OPERATOR_TOKEN>',
    AUTHORITY_REVIEWER_TOKEN: '<GENERATED_AND_PERSISTED_AUTHORITY_REVIEWER_TOKEN>',
    AUTHORITY_PUBLISHER_TOKEN: '<GENERATED_AND_PERSISTED_AUTHORITY_PUBLISHER_TOKEN>',
    AUTHORITY_VIEWER_TOKEN: '<GENERATED_AND_PERSISTED_AUTHORITY_VIEWER_TOKEN>',
  }
  return runtimeDocument.split(/\r?\n/).map((line) => {
    const index = line.indexOf('=')
    if (index <= 0) return line
    const name = line.slice(0, index)
    return textualValues[name] ? `${name}=${textualValues[name]}` : line
  }).join('\n').trim()
}

function buildConsolidatedDoc(project: ProjectRow, runtimeDocument: string): string {
  const manualEnvDocument = buildManualEnvDocument(project, runtimeDocument)
  const namespace = buildNamespace(project)
  const validationDomain = project.domain ? buildValidationDomain(project) : 'não configurado'
  const tables = tablesByType(project.business_type).join('\n- ')
  const target = project.hosting_target ?? 'não definido'
  const service = project.slug === 'authorityengine' ? 'authority' : (project.service_name ?? project.name.trim().split(/\s+/)[0]?.toLowerCase() ?? 'não definido')
  return [
    `# Documentação para Dev — ${project.name}`,
    '',
    '## 1. Identidade do projeto',
    '',
    `- **Project ID:** \`${project.id}\``,
    `- **Slug:** \`${project.slug}\``,
    `- **Tipo:** \`${project.business_type}\``,
    `- **Template:** \`${project.template_key}\` (v${project.template_version})`,
    `- **Schema exclusivo:** \`${project.schema_name}\``,
    `- **Domínio oficial:** ${project.domain ?? 'não configurado'}`,
    `- **Domínio de validação:** ${validationDomain}`,
    `- **Namespace:** \`${namespace}\``,
    `- **Target:** \`${target}\``,
    `- **Repository path:** \`${project.repository_path ?? '/09-codigo'}\``,
    `- **Easypanel project:** \`${project.hosting_project_name ?? 'não definido'}\``,
    `- **Easypanel service:** \`${service}\``,
    '',
    '## 2. Variáveis completas do runtime',
    '',
    'O bloco abaixo usa valores derivados reais quando seguros e marcadores textuais objetivos para credenciais. Substitua os marcadores privados pelos valores do provider autorizado antes do deploy.',
    '',
    '```env',
    manualEnvDocument,
    '```',
    '',
    '## 3. Procedimento manual no Easypanel',
    '',
    '1. Abra o projeto e o serviço informados acima.',
    '2. Configure o source path do repositório como `/09-codigo` (valor padrão persistido no catálogo).',
    '3. Abra **Environment**; o destino padrão do serviço é `.env`.',
    '4. Informe as variáveis exatamente com os nomes do bloco `env`.',
    '5. Nunca cole o bloco em Git, chat, ticket ou log.',
    '6. Salve o Environment e execute **Deploy**.',
    '7. Verifique o domínio de validação e aguarde HTTP 200.',
    '',
    '### Classificação das variáveis',
    '',
    '- `AUTHORITY_PROJECT_ID` e `AUTHORITY_OWNER_ID`: identidade derivada do catálogo.',
    '- `DATABASE_URL`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`: conexão/provider Supabase; `DATABASE_URL` precisa ser acessível pelo container do serviço.',
    '- `AUTHORITY_*_TOKEN`: tokens privados do Authority; nunca expor no frontend.',
    '- `PORT`, `HOST`, `NODE_ENV` e `APP_ENV`: configuração derivada do runtime.',
    '',
    '## 4. Regras de arquitetura',
    '',
    `- Operar exclusivamente no schema \`${project.schema_name}\`.`,
    '- Não criar, alterar ou excluir tabelas de governança no schema `public`.',
    '- Nunca enviar service role key ou tokens para o browser.',
    '- Persistir ownership com `project_id` e `owner_id`.',
    `- Tabelas esperadas no schema:`,
    `- ${tables}`,
    '',
    '## 5. Checklist de validação',
    '',
    '- [ ] Migration/runtime contract aplicado.',
    '- [ ] Variáveis salvas no `.env` do serviço correto.',
    '- [ ] `DATABASE_URL` não usa `localhost`, `127.0.0.1`, `::1` ou `db` inacessível.',
    '- [ ] Deploy concluído no serviço correto.',
    `- [ ] ${validationDomain} retorna HTTP 200.`,
    '- [ ] Authority executa preflight `select 1`.',
    '- [ ] Teste de escrita e readback concluído.',
    '- [ ] Restart/redeploy preserva owner e tokens.',
    '',
    '## 6. Segurança',
    '',
    'Este documento não deve conter valores secretos reais. Se uma credencial for exposta, revogue-a e gere uma nova antes de continuar.',
    '',
  ].join('\n')
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
      'id, name, slug, business_type, template_key, schema_name, domain, status, template_version, language, created_at, authority_owner_id, hosting_target, hosting_project_name, repository_path, service_name',
    )
    .eq('slug', slug)
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ error: 'Projeto não encontrado' }, { status: 404 })
  }

  const { data: runtimeContract, error: runtimeContractError } = await supabase
    .from('project_runtime_contracts')
    .select('document_markdown, env_document, environment, contract_version, status, updated_at')
    .eq('project_id', data.id)
    .eq('environment', 'production')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (runtimeContractError) {
    return NextResponse.json({ error: 'Runtime contract indisponível; migration 013/readback são obrigatórios.' }, { status: 503 })
  }
  if (runtimeContract) {
    const markdown = buildConsolidatedDoc(data as ProjectRow, runtimeContract.env_document ?? '')
    return new NextResponse(markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slug}-dev-doc.md"`,
        'X-Runtime-Contract-Version': runtimeContract.contract_version,
        'X-Runtime-Contract-Status': runtimeContract.status,
      },
    })
  }

  return NextResponse.json({ error: 'Runtime contract ainda não foi gerado; execute POST /runtime-contract antes do Developer Document.' }, { status: 409 })

  /* Legacy document generation remains below for reference during migration. */
  /* istanbul ignore next */
  const markdown = buildDoc(data as ProjectRow)

}
