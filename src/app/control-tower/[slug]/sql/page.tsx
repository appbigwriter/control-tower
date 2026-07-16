import { createServiceRoleClient } from '@/lib/supabase/service'

import { SqlEditorClient } from './sql-editor-client'

export const dynamic = 'force-dynamic'

type ProjectInfo = {
  name: string
  slug: string
  business_type: 'blog' | 'store' | 'saas' | 'custom'
  schema_name: string
  template_key: string
}

export default async function SqlEditorPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('projects')
    .select('name, slug, business_type, schema_name, template_key')
    .eq('slug', slug)
    .maybeSingle()

  const project = (data ?? null) as ProjectInfo | null

  return <SqlEditorClient slug={slug} project={project} />
}
