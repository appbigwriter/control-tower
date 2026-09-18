// GDB-REM-012: binding/provider failure + partial provisioning lifecycle.
// Intent is persisted as `pending` BEFORE provider injection; `active` only after
// external confirmation; provider failure transitions to `failed` (never active).
// Readback distinguishes intent / attempt / external confirmation.

import { runSaga, sagaSucceeded, sanitizeError, type SagaReceipt } from './saga.ts'

export interface BindingsClient {
  from: (table: string) => any
}

export interface BindingsMutation {
  data: unknown[] | null
  error: { message: string } | null
}

export interface BindingsMaybeSingle {
  data: unknown
  error: { message: string } | null
}

/** Provider surface used by the binding saga (Easypanel/local adapters satisfy this). */
export interface BindingSecretsProvider {
  name: string
  injectSecrets(namespace: string, secrets: Array<{ key_name: string; secret_value: string; reference_path?: string }>): Promise<void>
}

export interface BindingInput {
  secret_name: string
  reference_path?: string
  secret_value?: string | null
  provider?: string
  environment?: string
}

export interface NamespaceRow {
  id: string
  namespace: string
  provider: string
}

export interface BindingRegistrationRow {
  id: string
  namespace_id: string
  secret_name: string
  reference_path: string
  provider: string
  environment: string
  status: string
}

export interface BindingsResult {
  ok: boolean
  httpStatus: number
  sagaReceipt: SagaReceipt
  bindings: BindingRegistrationRow[]
  message: string
}

/**
 * Registers bindings as `pending` (intent), injects via provider when values are
 * present (admin path), then flips to `active` ONLY after provider success
 * (external confirmation). Provider failure sets `failed` — a failed provider
 * never leaves an active-confirmed binding.
 */
export async function registerBindingsWithLifecycle(
  client: BindingsClient,
  options: {
    namespace: NamespaceRow
    bindings: BindingInput[]
    actor: string
    isAdmin: boolean
    getProvider: (providerName: string) => BindingSecretsProvider
  },
): Promise<BindingsResult> {
  const { namespace, bindings, actor, isAdmin, getProvider } = options
  const hasSecretValues = bindings.some((b) => b.secret_value !== undefined && b.secret_value !== null && b.secret_value !== '')

  const recordsToUpsert = bindings.map((b) => ({
    namespace_id: namespace.id,
    secret_name: b.secret_name,
    reference_path: b.reference_path || `${namespace.namespace}${b.secret_name}`,
    provider: b.provider || namespace.provider || 'easypanel',
    environment: b.environment || 'production',
    // Intent first — never claim active before external confirmation.
    status: 'pending',
    created_by: actor,
    updated_at: new Date().toISOString(),
  }))

  let savedBindings: BindingRegistrationRow[] = []

  const receipt = await runSaga('secrets.bindings.register', [
    {
      name: 'upsert_bindings_pending',
      execute: async () => {
        const { data, error } = await client
          .from('secret_bindings')
          .upsert(recordsToUpsert, { onConflict: 'namespace_id,secret_name,environment' })
          .select('id, namespace_id, secret_name, reference_path, provider, environment, status, created_at, updated_at')
        if (error) throw new Error(`bindings upsert failed: ${error.message}`)
        savedBindings = (data ?? []) as BindingRegistrationRow[]
        return null
      },
      compensate: async () => {
        // Best effort: flip any pending rows we just wrote to failed so the
        // readback never shows pending-intent as confirmed.
        if (savedBindings.length > 0) {
          await client
            .from('secret_bindings')
            .update({ status: 'failed', updated_at: new Date().toISOString() })
            .eq('namespace_id', namespace.id)
        }
      },
    },
    ...(hasSecretValues && isAdmin
      ? [
          {
            name: 'provider_inject_secrets',
            execute: async () => {
              const secretsToInject = bindings
                .filter((b) => b.secret_value)
                .map((b) => ({
                  key_name: b.secret_name,
                  secret_value: b.secret_value as string,
                  reference_path: b.reference_path,
                }))
              const providerInstance = getProvider(namespace.provider)
              await providerInstance.injectSecrets(namespace.namespace, secretsToInject)
              return null
            },
            compensate: async () => {
              // Injection failed or a later step failed: mark failed, keep intent rows.
              await client
                .from('secret_bindings')
                .update({ status: 'failed', updated_at: new Date().toISOString() })
                .eq('namespace_id', namespace.id)
            },
          },
          {
            name: 'confirm_bindings_active',
            execute: async () => {
              const { error } = await client
                .from('secret_bindings')
                .update({ status: 'active', updated_at: new Date().toISOString() })
                .eq('namespace_id', namespace.id)
              if (error) throw new Error(`bindings activation failed: ${error.message}`)
              return null
            },
          },
        ]
      : []),
    {
      name: 'insert_audit_bindings_registered',
      execute: async () => {
        const { error } = await client.from('audit_logs').insert({
          action: 'secrets.bindings.registered',
          resource_type: 'secret_namespace',
          resource_id: namespace.id,
          metadata: {
            namespace: namespace.namespace,
            binding_count: bindings.length,
            injected: hasSecretValues && isAdmin,
            actor,
            statuses: savedBindings.map((b) => b.secret_name),
          },
        })
        if (error) throw new Error(`audit insert failed: ${error.message}`)
        return null
      },
    },
  ])

  if (!sagaSucceeded(receipt)) {
    // Readback of final states after failure handling.
    const { data } = await client
      .from('secret_bindings')
      .select('id, namespace_id, secret_name, reference_path, provider, environment, status, created_at, updated_at')
      .eq('namespace_id', namespace.id)
    savedBindings = (data ?? []) as BindingRegistrationRow[]

    return {
      ok: false,
      httpStatus: 502,
      sagaReceipt: receipt,
      bindings: savedBindings,
      message: `Falha no registro/injeção de bindings (${receipt.failedStep}); bindings marcados failed/pending — nunca active sem confirmação. ${sanitizeError(receipt.error) ?? ''}`.trim(),
    }
  }

  return {
    ok: true,
    httpStatus: 201,
    sagaReceipt: receipt,
    bindings: savedBindings,
    message: 'Bindings registrados por referência com lifecycle confirmado (pending → injeção → active).',
  }
}
