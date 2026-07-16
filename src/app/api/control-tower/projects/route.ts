import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { createServiceRoleClient } from '@/lib/supabase/service'

const businessTypes = ['blog', 'store', 'saas', 'custom'] as const
const templateKeys = ['blog_standard', 'store_standard', 'saas_standard', 'custom_base'] as const

const createProjectSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_]+$/, 'slug deve conter apenas letras minúsculas, números e underscore'),
  business_type: z.enum(businessTypes),
  template_key: z.enum(templateKeys),
  domain: z.string().trim().min(1).optional().nullable(),
  language: z.enum(['pt', 'en', 'es']).optional().default('pt'),
  organization_slug: z.string().min(1).optional().default('gestaodb'),
})

export async function GET() {
  try {
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, slug, business_type, template_key, schema_name, domain, status, template_version, created_at')
      .order('created_at', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ projects: data ?? [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro interno'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = createProjectSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Payload inválido' },
        { status: 400 },
      )
    }

    const { name, slug, business_type, template_key, domain, language, organization_slug } =
      parsed.data

    const supabase = createServiceRoleClient()

    const { data: organization, error: orgError } = await supabase
      .from('organizations')
      .select('id')
      .eq('slug', organization_slug)
      .maybeSingle()

    if (orgError) {
      return NextResponse.json({ error: orgError.message }, { status: 500 })
    }

    const { data: projectId, error } = await supabase.rpc('provision_project', {
      p_name: name,
      p_slug: slug,
      p_business_type: business_type,
      p_template_key: template_key,
      p_domain: domain ?? null,
      p_language: language,
      p_organization_id: organization?.id ?? null,
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(
      { message: 'Projeto provisionado com sucesso', project_id: projectId },
      { status: 201 },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro interno'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
