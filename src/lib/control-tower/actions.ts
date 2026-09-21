// GDB-REM-011: transactional-safety helpers for archive/delete/rebuild.
// Sequential steps with compensation; audit persistence is MANDATORY before
// reporting success; delete only removes the catalog after the schema removal
// readback confirms absence (or the state is left explicitly blocked).

import { runSaga, sagaSucceeded, type SagaReceipt } from './saga.ts'
import { readbackSchemaExists, schemaRemovalConfirmed, type SchemaReadback } from './readback.ts'

/** Minimal surface of the supabase client used here — keeps helpers unit-testable. */
export interface ActionsClient {
  from: (table: string) => any
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
}

export interface QueryOps {
  eq: (column: string, value: unknown) => QueryOps & Promise<MaybeSingleResult>
  maybeSingle: () => Promise<MaybeSingleResult>
}

export interface FilterOps {
  eq: (column: string, value: unknown) => FilterOps & Promise<MutationResult>
  select: (columns?: string) => FilterOps & Promise<MaybeSingleResult>
}

export interface MutationResult {
  data: unknown[] | null
  error: { message: string } | null
}

export interface MaybeSingleResult {
  data: unknown
  error: { message: string } | null
}

export interface ProjectRow {
  id: string
  name: string
  slug: string
  schema_name: string
  business_type: 'blog' | 'store' | 'saas' | 'custom'
  status?: string
}

export interface ActionResult {
  ok: boolean
  httpStatus: number
  action: string
  sagaReceipt: SagaReceipt
  readback?: SchemaReadback
  message: string
}

export async function loadProjectBySlug(
  client: ActionsClient,
  slug: string,
): Promise<ProjectRow | null> {
  const { data, error } = await client
    .from('projects')
    .select('id, name, slug, schema_name, business_type, status')
    .eq('slug', slug)
    .maybeSingle()
  if (error || !data) return null
  return data as ProjectRow
}

// ---------------------------------------------------------------------------
// Archive (GDB-REM-011 aceíte 2: archive never succeeds without persisted audit)
// ---------------------------------------------------------------------------

export async function archiveProject(
  client: ActionsClient,
  project: ProjectRow,
  actor: string,
): Promise<ActionResult> {
  // Audit FIRST (mandatory). If the audit insert fails we do not archive at all —
  // an unarchived project is safe; an unaudited archive is not.
  const receipt = await runSaga('project.archive', [
    {
      name: 'insert_audit_project_archived',
      execute: async () => {
        const { error } = await client.from('audit_logs').insert({
          project_id: project.id,
          action: 'project.archived',
          resource_type: 'project',
          resource_id: project.id,
          metadata: { slug: project.slug, schema_name: project.schema_name, actor },
        })
        if (error) throw new Error(`audit insert failed: ${error.message}`)
        return null
      },
    },
    {
      name: 'update_project_status_archived',
      execute: async () => {
        const { error } = await client
          .from('projects')
          .update({ status: 'archived' })
          .eq('id', project.id)
        if (error) throw new Error(`project update failed: ${error.message}`)
        return null
      },
      // Compensation: if a later step ever fails, restore prior status so the
      // catalog does not claim archived without full evidence.
      compensate: async () => {
        await client.from('projects').update({ status: project.status ?? 'active' }).eq('id', project.id)
      },
    },
  ])

  if (!sagaSucceeded(receipt)) {
    return {
      ok: false,
      httpStatus: 500,
      action: 'archive',
      sagaReceipt: receipt,
      message: `Archive falhou (${receipt.failedStep}); estado reconciliável registrado.`,
    }
  }
  return {
    ok: true,
    httpStatus: 200,
    action: 'archive',
    sagaReceipt: receipt,
    message: 'Projeto arquivado com sucesso (audit persistido).',
  }
}

// ---------------------------------------------------------------------------
// Delete (GDB-REM-011 aceíte 3: catalog removal only after confirmed schema drop,
// or explicit blocked state — never a ghost catalog / orphan schema silently)
// ---------------------------------------------------------------------------

export interface DeleteConfirmation {
  confirm: boolean
  slug: string
}

export function deleteConfirmationValid(body: unknown, slug: string): boolean {
  if (typeof body !== 'object' || body === null) return false
  const candidate = body as { confirm?: unknown; slug?: unknown }
  return candidate.confirm === true && candidate.slug === slug
}

export async function deleteProject(
  client: ActionsClient,
  project: ProjectRow,
  actor: string,
): Promise<ActionResult & { blocked?: boolean }> {
  const schemaName = project.schema_name
  const hasSchema = Boolean(schemaName) && schemaName !== 'public'

  const receipt = await runSaga('project.delete', [
    {
      name: 'insert_audit_delete_requested',
      execute: async () => {
        const { error } = await client.from('audit_logs').insert({
          project_id: project.id,
          action: 'project.delete_requested',
          resource_type: 'project',
          resource_id: project.id,
          metadata: { slug: project.slug, schema_name: schemaName, actor },
        })
        if (error) throw new Error(`audit insert failed: ${error.message}`)
        return null
      },
    },
    {
      name: 'mark_project_deleting',
      execute: async () => {
        const { error } = await client.from('projects').update({ status: 'error' }).eq('id', project.id)
        if (error) throw new Error(`status update failed: ${error.message}`)
        return null
      },
      compensate: async () => {
        await client.from('projects').update({ status: project.status ?? 'active' }).eq('id', project.id)
      },
    },
    ...(hasSchema
      ? [
          {
            name: 'drop_project_schema',
            execute: async () => {
              const beforeDrop = await readbackSchemaExists(client, schemaName)
              if (beforeDrop.error) throw new Error(`schema preflight inconclusive: ${beforeDrop.error}`)
              if (!beforeDrop.exists) return null
              const { error } = await client.rpc('drop_project_schema', {
                p_project_slug: project.slug,
                p_actor: `api-delete:${actor}`,
              })
              if (error) throw new Error(`schema drop failed: ${error.message}`)
              return null
            },
          },
        ]
      : []),
    {
      name: 'readback_schema_absence',
      execute: async () => {
        if (!hasSchema) return null // nothing to confirm
        const readback = await readbackSchemaExists(client, schemaName)
        if (!schemaRemovalConfirmed(readback)) {
          throw new Error(
            readback.error
              ? `schema removal readback inconclusive: ${readback.error}`
              : 'schema still exists after drop',
          )
        }
        return readback
      },
    },
    {
      name: 'insert_audit_deleted',
      execute: async () => {
        const { error } = await client.from('audit_logs').insert({
          project_id: project.id,
          action: 'project.deleted',
          resource_type: 'project',
          resource_id: project.id,
          metadata: { slug: project.slug, schema_name: schemaName, actor },
        })
        if (error) throw new Error(`audit insert failed: ${error.message}`)
        return null
      },
    },
    {
      name: 'delete_catalog_row',
      execute: async () => {
        const { error } = await client.from('projects').delete().eq('id', project.id)
        if (error) throw new Error(`catalog delete failed: ${error.message}`)
        return null
      },
    },
  ])

  const readback = hasSchema ? await readbackSchemaExists(client, schemaName) : undefined

  if (!sagaSucceeded(receipt)) {
    // Documented blocked state: catalog still present (status error) with audit
    // trail; reconcilable manually or by re-running delete.
    return {
      ok: false,
      blocked: true,
      httpStatus: 409,
      action: 'delete',
      sagaReceipt: receipt,
      readback,
      message:
        'Delete bloqueado em estado explícito (projeto marcado, audit preservado, catálogo intacto). ' +
        `Falha em: ${receipt.failedStep}. Ver receipt para compensação.`,
    }
  }
  return {
    ok: true,
    httpStatus: 200,
    action: 'delete',
    sagaReceipt: receipt,
    readback,
    message: 'Projeto excluído com sucesso (schema confirmado ausente antes da remoção do catálogo).',
  }
}

// ---------------------------------------------------------------------------
// Rebuild (GDB-REM-011 + audit gap: supabase.rpc does NOT throw on { error })
// ---------------------------------------------------------------------------

const SCHEMA_CREATE_RPC: Record<ProjectRow['business_type'], string> = {
  blog: 'create_blog_schema',
  store: 'create_store_schema',
  saas: 'create_saas_schema',
  custom: 'create_custom_schema',
}

export interface RebuildJobRow {
  id: string
}

export async function rebuildProjectSchema(
  client: ActionsClient,
  project: ProjectRow,
  actor: string,
): Promise<ActionResult> {
  const rpcName = SCHEMA_CREATE_RPC[project.business_type] ?? 'create_custom_schema'

  // Job row first, so every outcome (success or failure) is observable.
  const jobInsert = await client
    .from('provisioning_jobs')
    .insert({
      project_id: project.id,
      job_type: 'rebuild_schema',
      status: 'running',
      input_payload: { schema_name: project.schema_name },
    })
    .select('id')
  const jobId = (jobInsert.data?.[0] as RebuildJobRow | undefined)?.id

  const receipt = await runSaga('project.rebuild', [
    {
      name: 'rpc_create_schema',
      execute: async () => {
        // CRITICAL: supabase-js does not throw when the RPC returns { error }.
        const { error } = await client.rpc(rpcName, { p_schema_name: project.schema_name })
        if (error) throw new Error(`rpc ${rpcName} failed: ${error.message}`)
        return null
      },
    },
    {
      name: 'readback_schema_exists',
      execute: async () => {
        const readback = await readbackSchemaExists(client, project.schema_name)
        if (readback.error) throw new Error(`readback inconclusive: ${readback.error}`)
        if (!readback.exists) throw new Error('schema não existe após rebuild')
        return readback
      },
    },
    {
      name: 'update_project_active',
      execute: async () => {
        const { error } = await client.from('projects').update({ status: 'active' }).eq('id', project.id)
        if (error) throw new Error(`project update failed: ${error.message}`)
        return null
      },
    },
    {
      name: 'job_success',
      execute: async () => {
        const { error } = await client
          .from('provisioning_jobs')
          .update({
            status: 'success',
            finished_at: new Date().toISOString(),
            output_payload: { schema_name: project.schema_name },
          })
          .eq('id', jobId)
        if (error) throw new Error(`job update failed: ${error.message}`)
        return null
      },
    },
    {
      name: 'insert_audit_rebuilt',
      execute: async () => {
        const { error } = await client.from('audit_logs').insert({
          project_id: project.id,
          action: 'project.rebuilt',
          resource_type: 'project',
          resource_id: project.id,
          metadata: { slug: project.slug, schema_name: project.schema_name, actor, job_id: jobId },
        })
        if (error) throw new Error(`audit insert failed: ${error.message}`)
        return null
      },
    },
  ])

  if (!sagaSucceeded(receipt)) {
    // Job MUST be marked error; project marked error; sanitized audit persisted.
    await client
      .from('provisioning_jobs')
      .update({
        status: 'error',
        error_message: receipt.error ?? 'rebuild failed',
        finished_at: new Date().toISOString(),
      })
      .eq('id', jobId)
    await client.from('projects').update({ status: 'error' }).eq('id', project.id)
    await client.from('audit_logs').insert({
      project_id: project.id,
      action: 'project.rebuild_failed',
      resource_type: 'project',
      resource_id: project.id,
      metadata: { error: receipt.error, job_id: jobId, saga: receipt.saga, failed_step: receipt.failedStep },
    })
    return {
      ok: false,
      httpStatus: 500,
      action: 'rebuild',
      sagaReceipt: receipt,
      message: `Rebuild falhou (${receipt.failedStep}); job marcado error, projeto error.`,
    }
  }

  return {
    ok: true,
    httpStatus: 200,
    action: 'rebuild',
    sagaReceipt: receipt,
    readback: await readbackSchemaExists(client, project.schema_name),
    message: 'Schema reexecutado com sucesso (readback confirmado antes de success).',
  }
}
