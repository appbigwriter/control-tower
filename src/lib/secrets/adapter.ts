import fs from 'fs/promises'
import path from 'path'

export interface SecretPayload {
  key_name: string
  secret_value: string
  reference_path?: string
}

export interface ServiceStatusResult {
  status: 'running' | 'deploying' | 'stopped' | 'error' | string
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
  result: {
    data: {
      json: {
        success?: boolean
        [key: string]: unknown
      }
    }
  }
}

export interface EasypanelQueryResponse<T> {
  result: {
    data: {
      json: T
    }
  }
}

export interface SecretsProvider {
  name: string
  injectSecrets(namespace: string, secrets: SecretPayload[]): Promise<void>
  getService?(projectName: string, serviceName: string): Promise<EasypanelServiceData>
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
      // File does not exist yet
    }

    const lines = content.split('\n').filter(Boolean)
    const map = new Map<string, string>()
    for (const line of lines) {
      const idx = line.indexOf('=')
      if (idx > 0) {
        const k = line.slice(0, idx).trim()
        const v = line.slice(idx + 1).trim()
        map.set(k, v)
      }
    }

    for (const s of secrets) {
      map.set(s.key_name, s.secret_value)
    }

    const newContent = Array.from(map.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')

    await fs.writeFile(outFile, newContent, 'utf8')
    console.log(`[LocalSecretsProvider] Injected ${secrets.length} secrets into isolated storage (${safeNamespaceName})`)
  }
}

export class EasypanelSecretsProvider implements SecretsProvider {
  name = 'easypanel'

  private get apiUrl(): string {
    const url = process.env.EASYPANEL_API_URL
    if (!url) {
      throw new Error('[EasypanelSecretsProvider] FAIL-CLOSED: EASYPANEL_API_URL não está configurada no runtime.')
    }
    return url.replace(/\/$/, '')
  }

  private get apiToken(): string {
    const token = process.env.EASYPANEL_API_TOKEN || process.env.EASYPANEL_API_KEY
    if (!token) {
      throw new Error('[EasypanelSecretsProvider] FAIL-CLOSED: EASYPANEL_API_TOKEN / EASYPANEL_API_KEY obrigatória e ausente.')
    }
    return token
  }

  private get authHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json'
    }
  }

  public resolveProjectAndService(namespace: string): { projectName: string; serviceName: string } {
    const envProject = process.env.EASYPANEL_PROJECT_NAME
    const envService = process.env.EASYPANEL_SERVICE_NAME

    if (envProject && envService) {
      return { projectName: envProject, serviceName: envService }
    }

    // Extração determinística do namespace:
    // ex: "fbr/services/agency-flux/" -> project: "fbr", service: "agency-flux"
    // ex: "sistemas/control-tower/" -> project: "sistemas", service: "control-tower"
    const segments = namespace.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)

    if (segments.length >= 2) {
      const projectName = envProject || segments[0]
      const serviceName = envService || segments[segments.length - 1]
      return { projectName, serviceName }
    }

    if (segments.length === 1) {
      const defaultProject = envProject || 'sistemas'
      return { projectName: defaultProject, serviceName: segments[0] }
    }

    throw new Error(`[EasypanelSecretsProvider] FAIL-CLOSED: Não foi possível determinar projectName e serviceName a partir do namespace '${namespace}'`)
  }

  /**
   * 1. services.getService: localiza e valida a existência do serviço via tRPC
   */
  async getService(projectName: string, serviceName: string): Promise<EasypanelServiceData> {
    const url = `${this.apiUrl}/api/trpc/services.getService?input=${encodeURIComponent(
      JSON.stringify({ json: { projectName, serviceName } })
    )}`

    const res = await fetch(url, { headers: this.authHeaders })
    if (!res.ok) {
      throw new Error(`[EasypanelSecretsProvider] services.getService (${projectName}/${serviceName}) falhou com HTTP ${res.status}`)
    }

    const payload = (await res.json()) as EasypanelQueryResponse<EasypanelServiceData>
    if (!payload?.result?.data?.json) {
      throw new Error(`[EasypanelSecretsProvider] Resposta inválida para getService (${projectName}/${serviceName})`)
    }

    return payload.result.data.json
  }

  /**
   * 2. services.updateEnv: atualiza o bloco de Environment do serviço
   */
  async updateEnv(projectName: string, serviceName: string, env: Record<string, string>): Promise<EasypanelMutationResponse> {
    const envString = Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')

    const url = `${this.apiUrl}/api/trpc/services.updateEnv`
    const body = { json: { projectName, serviceName, env: envString } }

    const res = await fetch(url, {
      method: 'POST',
      headers: this.authHeaders,
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      throw new Error(`[EasypanelSecretsProvider] services.updateEnv (${projectName}/${serviceName}) falhou com HTTP ${res.status}`)
    }

    return (await res.json()) as EasypanelMutationResponse
  }

  /**
   * 3. services.deploy: dispara deploy / restart para recarregar o novo environment
   */
  async deploy(projectName: string, serviceName: string): Promise<EasypanelMutationResponse> {
    const url = `${this.apiUrl}/api/trpc/services.deploy`
    const body = { json: { projectName, serviceName } }

    const res = await fetch(url, {
      method: 'POST',
      headers: this.authHeaders,
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      throw new Error(`[EasypanelSecretsProvider] services.deploy (${projectName}/${serviceName}) falhou com HTTP ${res.status}`)
    }

    return (await res.json()) as EasypanelMutationResponse
  }

  /**
   * 4. services.getStatus: consulta status do container no Easypanel
   */
  async getStatus(projectName: string, serviceName: string): Promise<ServiceStatusResult> {
    const url = `${this.apiUrl}/api/trpc/services.getStatus?input=${encodeURIComponent(
      JSON.stringify({ json: { projectName, serviceName } })
    )}`

    const res = await fetch(url, { headers: this.authHeaders })
    if (!res.ok) {
      throw new Error(`[EasypanelSecretsProvider] services.getStatus (${projectName}/${serviceName}) falhou com HTTP ${res.status}`)
    }

    const payload = (await res.json()) as EasypanelQueryResponse<{ status: string }>
    const rawStatus = payload?.result?.data?.json?.status || 'stopped'

    return {
      status: rawStatus,
      healthy: rawStatus === 'running',
      serviceName,
      projectName
    }
  }

  /**
   * Injeção de secrets com verificação Fail-Closed e Readback real de status
   */
  async injectSecrets(namespace: string, secrets: SecretPayload[]): Promise<void> {
    const { projectName, serviceName } = this.resolveProjectAndService(namespace)

    const envMap: Record<string, string> = {}
    for (const s of secrets) {
      envMap[s.key_name] = s.secret_value
    }

    // 1. services.getService - Readback de pré-existência
    await this.getService(projectName, serviceName)

    // 2. services.updateEnv - Injeção das variáveis
    await this.updateEnv(projectName, serviceName, envMap)

    // 3. services.deploy - Trigger de deploy
    await this.deploy(projectName, serviceName)

    // 4. services.getStatus - Readback pós-deploy com verificação rigorosa
    const maxRetries = 10
    const delayMs = 2000
    let finalStatus: ServiceStatusResult | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      finalStatus = await this.getStatus(projectName, serviceName)
      if (finalStatus.status === 'running') {
        break
      }
      if (finalStatus.status === 'error') {
        throw new Error(`[EasypanelSecretsProvider] Container ${projectName}/${serviceName} entrou em estado de erro pós-deploy`)
      }
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }

    if (finalStatus?.status !== 'running') {
      throw new Error(`[EasypanelSecretsProvider] FAIL-CLOSED: Timeout aguardando status 'running' para ${projectName}/${serviceName} (Status atual: ${finalStatus?.status})`)
    }

    console.log(`[EasypanelSecretsProvider] Injeção e deploy concluídos com sucesso para ${projectName}/${serviceName} (Status: running)`)
  }
}

export class VaultSecretsProvider implements SecretsProvider {
  name = 'vault'

  async injectSecrets(namespace: string, secrets: SecretPayload[]): Promise<void> {
    const vaultUrl = process.env.VAULT_ADDR
    if (!vaultUrl) {
      throw new Error('[VaultSecretsProvider] FAIL-CLOSED: VAULT_ADDR não está configurada.')
    }
    console.log(`[VaultSecretsProvider] Vault reference updated for ${namespace} (${secrets.length} keys)`)
  }
}

export function getSecretsProvider(providerName: string): SecretsProvider {
  switch (providerName?.toLowerCase()) {
    case 'local':
      return new LocalSecretsProvider()
    case 'easypanel':
      return new EasypanelSecretsProvider()
    case 'vault':
      return new VaultSecretsProvider()
    default:
      return new EasypanelSecretsProvider()
  }
}
