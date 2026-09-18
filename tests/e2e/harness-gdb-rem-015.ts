// GDB-REM-015: local E2E harness — Authority → Flux → Blogs → Control Tower.
// Explicit in-memory mocks only: no network, no remote Supabase, no publication.
// The Control Tower leg is exercised through the same lib functions the API
// routes call (actions/bindings/readback), so state transitions are real logic.

import {
  runSaga,
  sagaSucceeded,
  type SagaReceipt,
} from '../../src/lib/control-tower/saga.ts'
import {
  archiveProject,
  deleteConfirmationValid,
  deleteProject,
  loadProjectBySlug,
  rebuildProjectSchema,
  type ActionsClient,
  type ActionResult,
  type ProjectRow,
} from '../../src/lib/control-tower/actions.ts'
import {
  registerBindingsWithLifecycle,
  type BindingsClient,
  type BindingRegistrationRow,
  type BindingSecretsProvider,
  type NamespaceRow,
} from '../../src/lib/control-tower/bindings.ts'
import {
  verifyDomain,
  canTransitionDomainState,
  type DomainVerificationAdapter,
  type DomainVerificationState,
} from '../../src/lib/control-tower/readback.ts'

// ---------------------------------------------------------------------------
// In-memory persistence shared by all legs (mock Supabase + Easypanel + DNS)
// ---------------------------------------------------------------------------

export interface MockAuditEntry {
  action: string
  project_id: string | null
  resource_type?: string
  resource_id?: string
  metadata: Record<string, unknown>
  at: string
}

export interface MockState {
  projects: Map<string, ProjectRow>
  provisioningJobs: Array<{ id: string; project_id: string; job_type: string; status: string; error_message?: string | null }>
  auditLogs: MockAuditEntry[]
  secretNamespaces: Map<string, NamespaceRow>
  secretBindings: Map<string, BindingRegistrationRow & { created_by: string }>
  domainVerification: Map<string, { project_id: string; domain: string; state: DomainVerificationState; attempts: number; last_error: string | null; health_readback_id: string | null; evidence: Record<string, unknown>; next_check_at: string | null }>
  schemas: Set<string> // existing isolated schemas
  idCounter: { n: number }
}

export function createMockState(): MockState {
  return {
    projects: new Map(),
    provisioningJobs: [],
    auditLogs: [],
    secretNamespaces: new Map(),
    secretBindings: new Map(),
    domainVerification: new Map(),
    schemas: new Set(),
    idCounter: { n: 0 },
  }
}

export function nextId(state: MockState): string {
  state.idCounter.n += 1
  return `id-${String(state.idCounter.n).padStart(4, '0')}`
}

// ---------------------------------------------------------------------------
// Mock clients implementing the narrow surfaces the libs consume
// ---------------------------------------------------------------------------

type FaultPlan = {
  dropSchemaRpc?: 'error'
  schemaExistsRpc?: 'error'
  auditInsert?: 'error'
  providerInject?: 'error'
}

/** Builds a mock ActionsClient with injectable per-operation faults. */
export function mockActionsClient(state: MockState, faults: FaultPlan = {}): ActionsClient {
  const isAuditInsert = (table: string, values: Record<string, unknown>) =>
    table === 'audit_logs' && typeof values.action === 'string'

  return {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      if (fn === 'project_schema_exists') {
        if (faults.schemaExistsRpc === 'error') {
          return { data: null, error: { message: 'connection reset during readback' } }
        }
        return { data: state.schemas.has(String(args?.p_schema_name)), error: null }
      }
      if (fn === 'drop_project_schema') {
        // GDB-REM-003: dedicated ownership-validated drop RPC.
        if (faults.dropSchemaRpc === 'error') {
          return { data: null, error: { message: 'drop schema rpc failed (simulated)' } }
        }
        const slug = String(args?.p_project_slug ?? '')
        const project = [...state.projects.values()].find((p) => p.slug === slug)
        if (!project) {
          return { data: null, error: { message: 'unknown project' } }
        }
        state.schemas.delete(project.schema_name)
        return { data: { schema_name: project.schema_name, status: 'dropped' }, error: null }
      }
      if (fn === 'execute_project_schema_sql') {
        const sql = String(args?.p_sql ?? '')
        const dropMatch = sql.match(/DROP SCHEMA IF EXISTS "([^"]+)" CASCADE/)
        if (dropMatch) {
          if (faults.dropSchemaRpc === 'error') {
            return { data: null, error: { message: 'drop schema rpc failed (simulated)' } }
          }
          state.schemas.delete(dropMatch[1])
          return { data: { schema_name: dropMatch[1], status: 'success' }, error: null }
        }
        return { data: null, error: { message: `unsupported rpc sql in mock: ${sql.slice(0, 40)}` } }
      }
      if (['create_blog_schema', 'create_store_schema', 'create_saas_schema', 'create_custom_schema'].includes(fn)) {
        state.schemas.add(String(args?.p_schema_name))
        return { data: null, error: null }
      }
      return { data: null, error: { message: `unknown rpc ${fn}` } }
    },
    from: (table: string) => ({
      select: (columns?: string) => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () => {
            if (table === 'projects' && column === 'slug') {
              const project = [...state.projects.values()].find((p) => p.slug === value)
              return { data: project ?? null, error: null }
            }
            if (table === 'provisioning_jobs' && column === 'id') {
              const job = state.provisioningJobs.find((j) => j.id === value) ?? null
              return { data: job, error: null }
            }
            return { data: null, error: null }
          },
          single: async () => ({ data: null, error: null }),
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: async (column: string, value: unknown) => {
          if (table === 'projects' && column === 'id') {
            const project = [...state.projects.values()].find((p) => p.id === String(value))
            if (project) Object.assign(project, values)
            return { data: null, error: null }
          }
          if (table === 'provisioning_jobs' && column === 'id') {
            const job = state.provisioningJobs.find((j) => j.id === value)
            if (job) Object.assign(job, values)
            return { data: null, error: null }
          }
          return { data: null, error: null }
        },
      }),
      insert: (values: Record<string, unknown> | Record<string, unknown>[]) => {
        const run = async (): Promise<{ data: unknown[] | null; error: { message: string } | null }> => {
          const rows = Array.isArray(values) ? values : [values]
          if (table === 'audit_logs') {
            if (faults.auditInsert === 'error' && rows.some((r) => isAuditInsert(table, r))) {
              return { data: null, error: { message: 'audit insert failed (simulated)' } }
            }
            for (const row of rows) {
              state.auditLogs.push({
                action: String(row.action),
                project_id: (row.project_id as string) ?? null,
                resource_type: row.resource_type as string | undefined,
                resource_id: row.resource_id as string | undefined,
                metadata: (row.metadata as Record<string, unknown>) ?? {},
                at: new Date().toISOString(),
              })
            }
            return { data: null, error: null }
          }
          if (table === 'provisioning_jobs') {
            const inserted = rows.map((row) => ({
              id: nextId(state),
              project_id: String(row.project_id),
              job_type: String(row.job_type),
              status: String(row.status),
            }))
            state.provisioningJobs.push(...inserted)
            return { data: inserted, error: null }
          }
          return { data: null, error: null }
        }
        return {
          select: async () => run(),
          then: (onFulfilled: unknown, onRejected: unknown) =>
            run().then(onFulfilled as never, onRejected as never),
        }
      },
      delete: () => ({
        eq: async (column: string, value: unknown) => {
          if (table === 'projects' && column === 'id') {
            state.projects.delete(String(value))
          }
          return { data: null, error: null }
        },
      }),
      eq: async () => ({ data: null, error: null }),
    }),
  } as unknown as ActionsClient
}

/** Mock bindings client (narrower surface). */
export function mockBindingsClient(state: MockState, faults: { providerInject?: 'error'; auditInsert?: 'error' } = {}): BindingsClient {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () => {
            if (table === 'secret_namespaces' && column === 'id') {
              const ns = state.secretNamespaces.get(String(value))
              return { data: ns ?? null, error: null }
            }
            return { data: null, error: null }
          },
          single: async () => {
            if (table === 'secret_namespaces' && column === 'id') {
              const ns = state.secretNamespaces.get(String(value))
              return { data: ns ?? null, error: ns ? null : { message: 'not found' } }
            }
            return { data: null, error: { message: 'not found' } }
          },
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: async (column: string, value: unknown) => {
          if (table === 'secret_bindings' && column === 'namespace_id') {
            for (const binding of state.secretBindings.values()) {
              if (binding.namespace_id === value) Object.assign(binding, values)
            }
          }
          return { data: null, error: null }
        },
      }),
      upsert: (values: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string }) => {
        void opts
        const rows = Array.isArray(values) ? values : [values]
        const select = async () => {
          const saved: BindingRegistrationRow[] = []
          for (const row of rows) {
            const key = `${row.namespace_id}:${row.secret_name}:${row.environment}`
            const existing = state.secretBindings.get(key)
            const merged: BindingRegistrationRow & { created_by: string } = {
              id: existing?.id ?? nextId(state),
              namespace_id: String(row.namespace_id),
              secret_name: String(row.secret_name),
              reference_path: String(row.reference_path),
              provider: String(row.provider),
              environment: String(row.environment),
              status: String(row.status),
              created_by: String(row.created_by ?? 'system'),
            } as BindingRegistrationRow & { created_by: string }
            state.secretBindings.set(key, merged)
            saved.push(merged)
          }
          return { data: saved, error: null }
        }
        return { select }
      },
      insert: async (values: Record<string, unknown> | Record<string, unknown>[]) => {
        const rows = Array.isArray(values) ? values : [values]
        if (table === 'audit_logs') {
          if (faults.auditInsert === 'error') {
            return { data: null, error: { message: 'audit insert failed (simulated)' } }
          }
          for (const row of rows) {
            state.auditLogs.push({
              action: String(row.action),
              project_id: (row.project_id as string) ?? null,
              resource_type: row.resource_type as string | undefined,
              resource_id: row.resource_id as string | undefined,
              metadata: (row.metadata as Record<string, unknown>) ?? {},
              at: new Date().toISOString(),
            })
          }
        }
        return { data: null, error: null }
      },
      eq: async () => ({ data: [], error: null }),
    }),
  } as unknown as BindingsClient
}

/** Failing/succeeding provider mock. */
export function mockSecretsProvider(state: MockState, fail: boolean): BindingSecretsProvider & { injections: Array<{ namespace: string; keys: string[] }> } {
  const injections: Array<{ namespace: string; keys: string[] }> = []
  return {
    name: 'mock-easypanel',
    injections,
    async injectSecrets(namespace, secrets) {
      injections.push({ namespace, keys: secrets.map((s) => s.key_name) })
      if (fail) throw new Error('provider injection failed (simulated easypanel outage)')
      state.schemas.add(`injected:${namespace}`) // not a schema; marker of external effect
    },
  }
}

/** DNS/health adapter mock with scripted outcomes. */
export function mockDomainAdapter(script: {
  dnsAddresses?: string[]
  dnsError?: string | null
  healthOk?: boolean
  healthStatus?: number | null
  healthError?: string | null
}): DomainVerificationAdapter {
  return {
    lookupDns: async () => ({
      addresses: script.dnsAddresses ?? [],
      error: script.dnsError ?? null,
    }),
    checkHealth: async () => ({
      ok: script.healthOk ?? false,
      status: script.healthStatus ?? null,
      error: script.healthError ?? null,
    }),
  }
}

// ---------------------------------------------------------------------------
// E2E flow legs
// ---------------------------------------------------------------------------

export interface E2EReceiptStep {
  leg: string
  ok: boolean
  detail: Record<string, unknown>
}

export interface E2ERunResult {
  ok: boolean
  steps: E2EReceiptStep[]
  publicationBlocked: boolean
  blockReasons: string[]
}

/**
 * Full local E2E: Authority (persona/blog baseline) → Flux (approval event +
 * idempotent job) → Blogs (content handoff) → Control Tower (provision, namespace,
 * bindings, domain verification, rebuild, archive/delete with gates) — all mocked.
 */
export async function runLocalE2E(options?: { providerFail?: boolean; breakAuditMidArchive?: boolean }): Promise<E2ERunResult> {
  const steps: E2EReceiptStep[] = []
  const blockReasons: string[] = []
  const state = createMockState()

  // ---- Leg 1: Authority — create persona/blog baseline with traceable ids ----
  const authorityCorrelationId = `corr-${nextId(state)}`
  const blogSlug = 'blog-e2e-local'
  const projectId = nextId(state)
  const project: ProjectRow = {
    id: projectId,
    name: 'Blog E2E Local',
    slug: blogSlug,
    schema_name: `blog_${blogSlug.replace(/-/g, '_')}`,
    business_type: 'blog',
    status: 'pending',
  }
  state.projects.set(blogSlug, project)
  steps.push({
    leg: 'authority.createPersonaBlog',
    ok: true,
    detail: { correlation_id: authorityCorrelationId, slug: blogSlug, project_id: projectId },
  })

  // ---- Leg 2: Flux — approval event idempotent (same key → same job) ----
  const eventKey = `flux-event-${authorityCorrelationId}`
  const fluxJobs = new Map<string, string>()
  const dispatchFluxEvent = (key: string): string => {
    const existing = fluxJobs.get(key)
    if (existing) return existing // idempotent replay returns original job
    const jobId = nextId(state)
    fluxJobs.set(key, jobId)
    state.provisioningJobs.push({ id: jobId, project_id: projectId, job_type: 'create_project', status: 'running' })
    return jobId
  }
  const jobId1 = dispatchFluxEvent(eventKey)
  const jobId2 = dispatchFluxEvent(eventKey)
  const fluxIdempotent = jobId1 === jobId2
  steps.push({
    leg: 'flux.approvalEventIdempotent',
    ok: fluxIdempotent,
    detail: { event_key: eventKey, job_id: jobId1, replay_same_job: fluxIdempotent },
  })
  if (!fluxIdempotent) blockReasons.push('flux replay criou job duplicado')

  // ---- Leg 3: Blogs — content handoff references namespace derived from project ----
  const namespace = `fbr/blogs/${projectId}`
  const nsId = nextId(state)
  state.secretNamespaces.set(nsId, { id: nsId, namespace, provider: 'easypanel' })
  steps.push({
    leg: 'blogs.handoffNamespace',
    ok: true,
    detail: { namespace, namespace_id: nsId, derived_from: 'business_type=blog + project_id' },
  })

  // ---- Leg 4: Control Tower — bindings lifecycle (GDB-REM-012) ----
  const actionsClient = mockActionsClient(state)
  const bindingsClient = mockBindingsClient(state)
  const provider = mockSecretsProvider(state, options?.providerFail ?? false)
  const bindingsResult = await registerBindingsWithLifecycle(bindingsClient, {
    namespace: { id: nsId, namespace, provider: 'easypanel' },
    bindings: [
      { secret_name: 'DATABASE_URL', secret_value: 'mock-not-real-value', reference_path: `${namespace}DATABASE_URL` },
    ],
    actor: 'e2e-local-runner',
    isAdmin: true,
    getProvider: () => provider,
  })
  const bindingsOk = bindingsResult.ok
  const noActiveWithoutConfirm = [...state.secretBindings.values()].every(
    (b) => (b.status === 'active') === (bindingsOk && provider.injections.length > 0),
  )
  steps.push({
    leg: 'controlTower.bindingsLifecycle',
    ok: bindingsOk && noActiveWithoutConfirm,
    detail: {
      saga_status: bindingsResult.sagaReceipt.status,
      binding_statuses: [...state.secretBindings.values()].map((b) => `${b.secret_name}=${b.status}`),
      provider_injections: provider.injections.length,
    },
  })
  if (!bindingsOk) blockReasons.push('bindings: provider falhou — binding não pode ficar active')

  // ---- Leg 5: Control Tower — DNS/health technical verification (GDB-REM-013) ----
  const domain = 'blog-e2e-local.example.com'
  const dnsAdapterOk = mockDomainAdapter({ dnsAddresses: ['203.0.113.10'], healthOk: true, healthStatus: 200 })
  const verificationOk = await verifyDomain({
    domain,
    attempts: 0,
    adapter: dnsAdapterOk,
    now: () => new Date('2026-09-18T12:00:00Z'),
  })
  state.domainVerification.set(projectId, {
    project_id: projectId,
    domain,
    state: verificationOk.state,
    attempts: verificationOk.attempts,
    last_error: verificationOk.error,
    health_readback_id: verificationOk.healthReadbackId || null,
    evidence: verificationOk.evidence as Record<string, unknown>,
    next_check_at: verificationOk.nextCheckAt,
  })
  const dnsOk = verificationOk.state === 'dns_verified'
  steps.push({
    leg: 'controlTower.domainVerification',
    ok: dnsOk,
    detail: {
      state: verificationOk.state,
      attempts: verificationOk.attempts,
      health_readback_id: verificationOk.healthReadbackId,
      evidence: { dns_addresses: verificationOk.evidence.dns?.addresses, health_status: verificationOk.evidence.health?.status },
    },
  })

  // Negative DNS check: manual confirm without technical proof stays blocked.
  const dnsAdapterFail = mockDomainAdapter({ dnsAddresses: [], dnsError: 'NXDOMAIN' })
  const verificationFail = await verifyDomain({ domain: 'unverified.example.com', attempts: 0, adapter: dnsAdapterFail, maxAttempts: 1, now: () => new Date('2026-09-18T12:00:00Z') })
  const failStaysBlocked = verificationFail.state === 'dns_failed' && verificationFail.nextCheckAt !== null
  steps.push({
    leg: 'controlTower.domainVerificationNegative',
    ok: failStaysBlocked,
    detail: { state: verificationFail.state, next_check_at: verificationFail.nextCheckAt, error: verificationFail.error },
  })

  // ---- Leg 6: Control Tower — provision (schema create + readback) + rebuild ----
  const rebuildResult = await rebuildProjectSchema(actionsClient, project, 'e2e-local-runner')
  const rebuildReadbackOk = rebuildResult.ok && state.schemas.has(project.schema_name)
  steps.push({
    leg: 'controlTower.rebuildWithReadback',
    ok: rebuildReadbackOk,
    detail: {
      saga_status: rebuildResult.sagaReceipt.status,
      schema_exists_in_state: state.schemas.has(project.schema_name),
      failed_step: rebuildResult.sagaReceipt.failedStep,
    },
  })

  // ---- Leg 7: archive with audit guarantee ----
  project.status = 'active'
  const archiveClient = options?.breakAuditMidArchive
    ? mockActionsClient(state, { auditInsert: 'error' })
    : actionsClient
  const archiveResult = await archiveProject(archiveClient, project, 'e2e-local-runner')
  const archiveAuditPersisted = state.auditLogs.some((a) => a.action === 'project.archived' && a.project_id === projectId)
  const archiveOk = archiveResult.ok === archiveAuditPersisted && (options?.breakAuditMidArchive ? !archiveResult.ok : archiveResult.ok)
  steps.push({
    leg: 'controlTower.archiveAuditGuarantee',
    ok: archiveOk,
    detail: {
      saga_status: archiveResult.sagaReceipt.status,
      audit_persisted: archiveAuditPersisted,
      project_status_after: state.projects.get(blogSlug)?.status,
    },
  })

  // ---- Leg 8: delete gated by explicit confirmation + readback before catalog drop ----
  const confirmOk = deleteConfirmationValid({ confirm: true, slug: blogSlug }, blogSlug)
  const confirmReject = deleteConfirmationValid({ confirm: true, slug: 'other-slug' }, blogSlug) || deleteConfirmationValid({ confirm: false, slug: blogSlug }, blogSlug)
  const deleteGateOk = confirmOk && !confirmReject
  steps.push({
    leg: 'controlTower.deleteConfirmationGate',
    ok: deleteGateOk,
    detail: { valid_body_accepted: confirmOk, invalid_body_rejected: !confirmReject },
  })

  let deleteResult: ActionResult & { blocked?: boolean } | null = null
  if (deleteGateOk) {
    project.status = 'archived'
    deleteResult = await deleteProject(actionsClient, project, 'e2e-local-runner')
    const catalogRemoved = !state.projects.has(blogSlug)
    const auditDeleteLogged = state.auditLogs.some((a) => a.action === 'project.deleted' && a.project_id === projectId)
    steps.push({
      leg: 'controlTower.deleteWithReadback',
      ok: deleteResult.ok && catalogRemoved && auditDeleteLogged,
      detail: {
        saga_status: deleteResult.sagaReceipt.status,
        catalog_removed: catalogRemoved,
        audit_logged: auditDeleteLogged,
        schema_exists_after: state.schemas.has(project.schema_name),
        failed_step: deleteResult.sagaReceipt.failedStep,
      },
    })
  }

  // ---- Publication gate: only when EVERY leg is verified ----
  const failedLegs = steps.filter((s) => !s.ok)
  const publicationBlocked = failedLegs.length > 0
  if (publicationBlocked) {
    blockReasons.push(`pernas falhas: ${failedLegs.map((s) => s.leg).join(', ')}`)
  }

  return {
    ok: !publicationBlocked,
    steps,
    publicationBlocked,
    blockReasons,
  }
}

// Re-export for test convenience
export { runSaga, sagaSucceeded }
export type { SagaReceipt }
