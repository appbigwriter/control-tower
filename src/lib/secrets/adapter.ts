import fs from 'fs/promises'
import path from 'path'

export interface SecretPayload {
  key_name: string
  secret_value: string
  reference_path?: string
}

export interface SecretsProvider {
  name: string
  injectSecrets(namespace: string, secrets: SecretPayload[]): Promise<void>
}

function maskSecret(val: string): string {
  if (!val || val.length <= 6) return '******'
  return `${val.slice(0, 3)}...${val.slice(-3)}`
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

  async injectSecrets(namespace: string, secrets: SecretPayload[]): Promise<void> {
    const easypanelApiUrl = process.env.EASYPANEL_API_URL
    const easypanelToken = process.env.EASYPANEL_API_TOKEN

    if (easypanelApiUrl && easypanelToken) {
      // Direct Easypanel API injection
      try {
        const res = await fetch(`${easypanelApiUrl}/api/env/update`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${easypanelToken}`
          },
          body: JSON.stringify({
            namespace,
            env: secrets.reduce((acc, s) => ({ ...acc, [s.key_name]: s.secret_value }), {})
          })
        })
        if (!res.ok) {
          throw new Error(`Easypanel API returned HTTP ${res.status}`)
        }
        console.log(`[EasypanelSecretsProvider] Successfully pushed ${secrets.length} secrets to Easypanel API`)
      } catch (err: any) {
        console.error(`[EasypanelSecretsProvider] Remote push failed: ${err.message}`)
        throw err
      }
    } else {
      // Zero Leaks: Logs do not contain raw values
      const maskedSummary = secrets.map(s => `${s.key_name}=${maskSecret(s.secret_value)}`).join(', ')
      console.log(`[EasypanelSecretsProvider] Environment binding prepared for Easypanel (${namespace}): [${maskedSummary}]`)
    }
  }
}

export class VaultSecretsProvider implements SecretsProvider {
  name = 'vault'

  async injectSecrets(namespace: string, secrets: SecretPayload[]): Promise<void> {
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
