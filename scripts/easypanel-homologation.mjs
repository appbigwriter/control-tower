import { pathToFileURL } from 'node:url'

const IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/
const HOMOLOGATION_MARKER = 'fbr-homologation-marker'

export function normalizeBaseUrl(rawUrl) {
  const value = String(rawUrl ?? '').trim().replace(/\/+$/, '').replace(/(?:\/api)+$/, '')
  if (!value || !/^https?:\/\/[^\s/]+(?::\d+)?(?:\/[^\s]*)?$/i.test(value)) {
    throw new Error('EASYPANEL_API_URL inválida')
  }
  return `${value}/api`
}

export function deriveProjectAndService(namespace, env = process.env) {
  const segments = String(namespace ?? '').trim().replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  const serviceName = segments.at(-1)
  const projectName = String(env.EASYPANEL_PROJECT_NAME ?? 'projetos').trim()
  if (segments.length < 2 || !serviceName || !IDENTIFIER_PATTERN.test(serviceName)) {
    throw new Error('namespace sem serviceName ou identificador inválido')
  }
  if (!IDENTIFIER_PATTERN.test(projectName)) throw new Error('EASYPANEL_PROJECT_NAME inválido')
  return { projectName, serviceName }
}

export function buildRequestPayload(endpoint, projectName, serviceName, env = {}) {
  const payload = { projectName, serviceName }
  if (endpoint === 'updateAppEnv') {
    payload.env = Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')
  }
  return payload
}

function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null
}

function serviceNameOf(value) {
  const record = asRecord(value)
  const candidate = record?.name ?? record?.serviceName
  return typeof candidate === 'string' ? candidate : undefined
}

function projectNameOf(value) {
  const record = asRecord(value)
  const candidate = record?.name ?? record?.projectName
  return typeof candidate === 'string' ? candidate : undefined
}

function serviceExistsInProject(project, serviceName) {
  const record = asRecord(project)
  return Array.isArray(record?.services) && record.services.some((service) => serviceNameOf(service) === serviceName)
}

export function readbackHasService(readback, projectName, serviceName) {
  if (Array.isArray(readback)) {
    return readback.some((project) => projectNameOf(project) === projectName && serviceExistsInProject(project, serviceName))
  }
  const record = asRecord(readback)
  if (!record) return false
  if (projectNameOf(record) === projectName && serviceExistsInProject(record, serviceName)) return true
  return Object.values(record).some((value) => readbackHasService(value, projectName, serviceName))
}

export function extractActionId(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = extractActionId(item)
      if (id) return id
    }
    return undefined
  }
  const record = asRecord(value)
  if (!record) return undefined
  for (const key of ['id', 'actionId']) {
    if (typeof record[key] === 'string' && record[key]) return record[key]
  }
  for (const item of Object.values(record)) {
    const id = extractActionId(item)
    if (id) return id
  }
  return undefined
}

function inspectContainsEnv(readback, expectedEnv) {
  const record = asRecord(readback)
  if (!record || typeof record.env !== 'string') return false
  const observed = new Map()
  for (const line of record.env.split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator > 0) observed.set(line.slice(0, separator), line.slice(separator + 1))
  }
  return Object.entries(expectedEnv).every(([key, value]) => observed.get(key) === value)
}

function hasInspectableValue(value) {
  return value !== null && value !== undefined
}

function safeError(error) {
  if (error instanceof Error && error.message) {
    return error.message
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
      .replace(/https?:\/\/\S+/gi, '[redacted-url]')
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 240)
  }
  return 'operação Easypanel falhou'
}

export function createRestClient(env = process.env, fetchImpl = globalThis.fetch) {
  const rawUrl = env.EASYPANEL_API_URL
  const token = String(env.EASYPANEL_API_TOKEN ?? '').trim()
  if (!rawUrl) throw new Error('EASYPANEL_API_URL ausente')
  if (!token) throw new Error('EASYPANEL_API_TOKEN ausente')
  const baseUrl = normalizeBaseUrl(rawUrl)
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  if (typeof fetchImpl !== 'function') throw new Error('fetch indisponível')

  async function request(method, endpoint, paramsOrBody = {}) {
    const url = new URL(`${baseUrl}/${endpoint}`)
    const init = { method, headers }
    if (method === 'GET') {
      for (const [key, value] of Object.entries(paramsOrBody)) {
        if (value !== undefined) url.searchParams.set(key, String(value))
      }
    } else {
      init.body = JSON.stringify(paramsOrBody)
    }
    const response = await fetchImpl(url, init)
    if (!response.ok) throw new Error(`${endpoint} HTTP ${response.status}`)
    try {
      return await response.json()
    } catch {
      return null
    }
  }

  return {
    request,
    listProjectsAndServices: () => request('GET', 'listProjectsAndServices'),
    inspectAppService: (projectName, serviceName) => request('GET', 'inspectAppService', { projectName, serviceName }),
    createAppService: (projectName, serviceName) => request('POST', 'createAppService', buildRequestPayload('createAppService', projectName, serviceName)),
    updateAppEnv: (projectName, serviceName, values) => request('POST', 'updateAppEnv', buildRequestPayload('updateAppEnv', projectName, serviceName, values)),
    deployAppService: (projectName, serviceName) => request('POST', 'deployAppService', buildRequestPayload('deployAppService', projectName, serviceName)),
    destroyAppService: (projectName, serviceName) => request('POST', 'destroyAppService', buildRequestPayload('destroyAppService', projectName, serviceName)),
    listActions: (params) => request('GET', 'listActions', params),
    getAction: (id) => request('GET', 'getAction', { id }),
  }
}

function printStatus(step, status, message) {
  const output = { step, status: String(status) }
  if (message) output.message = String(message).replace(/[\r\n]+/g, ' ').slice(0, 240)
  process.stdout.write(`${JSON.stringify(output)}\n`)
}

export async function run(env = process.env, fetchImpl = globalThis.fetch) {
  const namespace = env.EASYPANEL_HOMOLOGATION_NAMESPACE
  if (!namespace) throw new Error('EASYPANEL_HOMOLOGATION_NAMESPACE ausente')
  const { projectName, serviceName } = deriveProjectAndService(namespace, env)
  const client = createRestClient(env, fetchImpl)
  let createdByTest = false
  let destroyedByTest = false

  try {
    const before = await client.listProjectsAndServices()
    if (readbackHasService(before, projectName, serviceName)) {
      printStatus('pre-check', 'ABORTED_EXISTS')
      throw new Error('serviço já existente; nenhum recurso foi criado pelo teste')
    }
    printStatus('pre-check', 'ABSENT_BEFORE_TEST')

    await client.createAppService(projectName, serviceName)
    const afterCreate = await client.listProjectsAndServices()
    if (!readbackHasService(afterCreate, projectName, serviceName)) {
      printStatus('create-readback', 'NOT_CONFIRMED')
      throw new Error('readback não confirmou criação; cleanup bloqueado')
    }
    createdByTest = true
    printStatus('create-readback', 'CONFIRMED')

    const marker = { FBR_EASYPANEL_HOMOLOGATION_MARKER: HOMOLOGATION_MARKER }
    await client.updateAppEnv(projectName, serviceName, marker)
    const afterUpdate = await client.inspectAppService(projectName, serviceName)
    if (!inspectContainsEnv(afterUpdate, marker)) {
      printStatus('update-readback', 'NOT_CONFIRMED')
      throw new Error('readback não confirmou marcador')
    }
    printStatus('update-readback', 'CONFIRMED')

    await client.deployAppService(projectName, serviceName)
    const afterDeploy = await client.inspectAppService(projectName, serviceName)
    printStatus('deploy-readback', hasInspectableValue(afterDeploy) ? 'RECEIVED' : 'NOT_CONFIRMED')
    if (!hasInspectableValue(afterDeploy)) throw new Error('readback pós-deploy não recebido')

    const actions = await client.listActions({ limit: 8, projectName, serviceName })
    printStatus('list-actions', hasInspectableValue(actions) ? 'RECEIVED' : 'NOT_CONFIRMED')
    if (!hasInspectableValue(actions)) throw new Error('listActions não recebido')
    const id = extractActionId(actions)
    if (id) {
      const action = await client.getAction(id)
      printStatus('get-action', hasInspectableValue(action) ? 'RECEIVED' : 'NOT_CONFIRMED')
      if (!hasInspectableValue(action)) throw new Error('getAction não recebido')
    } else printStatus('get-action', 'NO_ID_OBSERVED')
  } finally {
    if (createdByTest && !destroyedByTest) {
      await client.destroyAppService(projectName, serviceName)
      destroyedByTest = true
      printStatus('destroy', 'REQUESTED')
      const postDestroy = await client.listProjectsAndServices()
      const absent = !readbackHasService(postDestroy, projectName, serviceName)
      printStatus('post-destroy-readback', absent ? 'ABSENT_CONFIRMED' : 'STILL_PRESENT')
      if (!absent) throw new Error('readback pós-destruição ainda confirma o serviço')
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await run()
  } catch (error) {
    printStatus('homologation', 'FAILED', safeError(error))
    process.exitCode = 1
  }
}
