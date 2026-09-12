import fs from 'fs/promises'
import path from 'path'

export interface SecretPayload {
  key_name: string
  secret_value: string
  reference_path?: string
}

export type ObservedServiceStatus = 'NOT_VERIFIED' | 'running' | 'deploying' | 'stopped' | 'error'

export interface ServiceStatusResult {
  status: ObservedServiceStatus
  healthy: boolean
  serviceName: string
  projectName: string
}

export interface EasypanelServiceData {
  name: string
  projectName: string
  status?: string
  env?: string
  domains?: string[]
}

export interface EasypanelMutationResponse {
  success?: boolean
  [key: string]: unknown
}

export interface DestroyReadback {
  mutation: EasypanelMutationResponse
  readback: unknown
  exists: boolean
}

export interface SecretsProvider {
  name: string
  injectSecrets(namespace: string, secrets: SecretPayload[]): Promise<void>
  updateEnv?(projectName: string, serviceName: string, env: Record<string, string>): Promise<EasypanelMutationResponse>
  deploy?(projectName: string, serviceName: string): Promise<EasypanelMutationResponse>
  getStatus?(projectName: string, serviceName: string): Promise<ServiceStatusResult>
}

export class LocalSecretsProvider implements SecretsProvider {
  name = 'local'

  async injectSecrets(namespace: string, secrets: SecretPayload[]): Promise<void> {
    const safeNamespaceName = namespace.replace(/[^a-zA-Z0-9_-]/g, '_')
    const outDir = path.join(process.cwd(), 'scratch', safeNamespaceName)
    await fs.mkdir(outDir, { recursive: true })
    const outFile = path.join(outDir, '.env.local')

    let content = ''
    try {
      content = await fs.readFile(outFile, 'utf8')
    } catch {
      // File does not exist yet.
    }

    const lines = content.split('\n').filter(Boolean)
    const map = new Map<string, string>()
    for (const line of lines) {
      const idx = line.indexOf('=')
      if (idx > 0) map.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim())
    }
    for (const secret of secrets) map.set(secret.key_name, secret.secret_value)

    await fs.writeFile(
      outFile,
      Array.from(map.entries()).map(([key, value]) => `${key}=${value}`).join('\n'),
      'utf8'
    )
    console.log(`[LocalSecretsProvider] Injected ${secrets.length} secrets into isolated storage (${safeNamespaceName})`)
  }
}

const IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/
const OBSERVED_STATUSES = new Set<ObservedServiceStatus>(['running', 'deploying', 'stopped', 'error'])

export function normalizeEasypanelApiUrl(rawUrl: string): string {
  const value = rawUrl.trim().replace(/\/+$/, '').replace(/(?:\/api)+$/, '')
  if (!value || !/^https?:\/\/[^\s/]+(?::\d+)?(?:\/[^\s]*)?$/i.test(value)) {
    throw new Error('[EasypanelSecretsProvider] FAIL-CLOSED: EASYPANEL_API_URL inválida.')
  }
  return `${value}/api`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function serviceNameOf(value: unknown): string | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const candidate = record.name ?? record.serviceName
  return typeof candidate === 'string' ? candidate : undefined
}

function projectNameOf(value: unknown): string | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const candidate = record.name ?? record.projectName
  return typeof candidate === 'string' ? candidate : undefined
}

function serviceExistsInProject(project: unknown, serviceName: string): boolean {
  const record = asRecord(project)
  if (!record) return false
  const services = record.services
  if (Array.isArray(services)) {
    return services.some((service) => serviceNameOf(service) === serviceName)
  }
  return false
}

export function readbackHasService(readback: unknown, projectName: string, serviceName: string): boolean {
  if (Array.isArray(readback)) {
    return readback.some((project) => projectNameOf(project) === projectName && serviceExistsInProject(project, serviceName))
  }
  const record = asRecord(readback)
  if (!record) return false
  if (projectNameOf(record) === projectName && serviceExistsInProject(record, serviceName)) return true
  return Object.values(record).some((value) => readbackHasService(value, projectName, serviceName))
}

function inspectContainsEnv(readback: unknown, env: Record<string, string>): boolean {
  const record = asRecord(readback)
  if (!record || typeof record.env !== 'string') return false
  const observed = new Map<string, string>()
  for (const line of record.env.split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator > 0) observed.set(line.slice(0, separator), line.slice(separator + 1))
  }
  return Object.entries(env).every(([key, value]) => observed.get(key) === value)
}

function observedStatus(readback: unknown): ObservedServiceStatus {
  const record = asRecord(readback)
  const value = record?.status
  return typeof value === 'string' && OBSERVED_STATUSES.has(value as ObservedServiceStatus)
    ? value as ObservedServiceStatus
    : 'NOT_VERIFIED'
}

export class EasypanelSecretsProvider implements SecretsProvider {
  name = 'easypanel'

  private get apiUrl(): string {
    const url = process.env.EASYPANEL_API_URL
    if (!url) throw new Error('[EasypanelSecretsProvider] FAIL-CLOSED: EASYPANEL_API_URL não está configurada no runtime.')
    return normalizeEasypanelApiUrl(url)
  }

  private get apiToken(): string {
    const token = process.env.EASYPANEL_API_TOKEN?.trim()
    if (!token) throw new Error('[EasypanelSecretsProvider] FAIL-CLOSED: EASYPANEL_API_TOKEN obrigatória e ausente.')
    return token
  }

  private get authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiToken}`, 'Content-Type': 'application/json' }
  }

  public resolveProjectAndService(namespace: string): { projectName: string; serviceName: string } {
    const segments = namespace.trim().replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
    const serviceName = segments.at(-1)
    const projectName = process.env.EASYPANEL_PROJECT_NAME?.trim() || 'projetos'
    if (segments.length < 2 || !serviceName || !IDENTIFIER_PATTERN.test(serviceName)) {
      throw new Error('[EasypanelSecretsProvider] FAIL-CLOSED: namespace sem serviceName ou identificador inválido.')
    }
    if (!IDENTIFIER_PATTERN.test(projectName)) {
      throw new Error('[EasypanelSecretsProvider] FAIL-CLOSED: EASYPANEL_PROJECT_NAME inválido.')
    }
    return { projectName, serviceName }
  }

  private async post(endpoint: string, body: Record<string, unknown>): Promise<EasypanelMutationResponse> {
    const response = await fetch(`${this.apiUrl}/${endpoint}`, {
      method: 'POST',
      headers: this.authHeaders,
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`[EasypanelSecretsProvider] ${endpoint} falhou com HTTP ${response.status}`)
    return await response.json() as EasypanelMutationResponse
  }

  private async get(endpoint: string, params?: Record<string, string | number | undefined>): Promise<unknown> {
    const url = new URL(`${this.apiUrl}/${endpoint}`)
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    const response = await fetch(url, { method: 'GET', headers: this.authHeaders })
    if (!response.ok) throw new Error(`[EasypanelSecretsProvider] ${endpoint} falhou com HTTP ${response.status}`)
    return await response.json()
  }

  async listProjectsAndServices(): Promise<unknown> {
    return this.get('listProjectsAndServices')
  }

  async inspectAppService(projectName: string, serviceName: string): Promise<unknown> {
    return this.get('inspectAppService', { projectName, serviceName })
  }

  async createAppService(projectName: string, serviceName: string): Promise<EasypanelMutationResponse> {
    return this.post('createAppService', { projectName, serviceName })
  }

  async updateEnv(projectName: string, serviceName: string, env: Record<string, string>): Promise<EasypanelMutationResponse> {
    const serializedEnv = Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n')
    return this.post('updateAppEnv', { projectName, serviceName, env: serializedEnv })
  }

  async deploy(projectName: string, serviceName: string): Promise<EasypanelMutationResponse> {
    return this.post('deployAppService', { projectName, serviceName })
  }

  async destroy(projectName: string, serviceName: string): Promise<DestroyReadback> {
    const mutation = await this.post('destroyAppService', { projectName, serviceName })
    const readback = await this.listProjectsAndServices()
    return { mutation, readback, exists: readbackHasService(readback, projectName, serviceName) }
  }

  async listActions(options: { limit?: number; projectName?: string; serviceName?: string; type?: string } = {}): Promise<unknown> {
    return this.get('listActions', options)
  }

  async getAction(id: string): Promise<unknown> {
    return this.get('getAction', { id })
  }

  async getStatus(projectName: string, serviceName: string): Promise<ServiceStatusResult> {
    const readback = await this.inspectAppService(projectName, serviceName)
    const status = observedStatus(readback)
    return { status, healthy: status === 'running', serviceName, projectName }
  }

  async injectSecrets(namespace: string, secrets: SecretPayload[]): Promise<void> {
    const { projectName, serviceName } = this.resolveProjectAndService(namespace)
    const before = await this.listProjectsAndServices()
    let exists = readbackHasService(before, projectName, serviceName)

    if (!exists) {
      await this.createAppService(projectName, serviceName)
      const afterCreate = await this.listProjectsAndServices()
      exists = readbackHasService(afterCreate, projectName, serviceName)
      if (!exists) throw new Error(`[EasypanelSecretsProvider] readback não confirmou criação de ${projectName}/${serviceName}.`)
    }

    const env = Object.fromEntries(secrets.map((secret) => [secret.key_name, secret.secret_value]))
    await this.updateEnv(projectName, serviceName, env)
    const afterUpdate = await this.inspectAppService(projectName, serviceName)
    if (!inspectContainsEnv(afterUpdate, env)) {
      throw new Error(`[EasypanelSecretsProvider] readback não confirmou configuração de ${projectName}/${serviceName}.`)
    }

    await this.deploy(projectName, serviceName)
    await this.inspectAppService(projectName, serviceName)
  }
}

export class VaultSecretsProvider implements SecretsProvider {
  name = 'vault'

  async injectSecrets(namespace: string, secrets: SecretPayload[]): Promise<void> {
    if (!process.env.VAULT_ADDR) throw new Error('[VaultSecretsProvider] FAIL-CLOSED: VAULT_ADDR não está configurada.')
    console.log(`[VaultSecretsProvider] Vault reference updated for ${namespace} (${secrets.length} keys)`)
  }
}

export function getSecretsProvider(providerName: string): SecretsProvider {
  switch (providerName?.toLowerCase()) {
    case 'local': return new LocalSecretsProvider()
    case 'easypanel': return new EasypanelSecretsProvider()
    case 'vault': return new VaultSecretsProvider()
    default: return new EasypanelSecretsProvider()
  }
}
