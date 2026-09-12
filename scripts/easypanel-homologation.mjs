import assert from 'node:assert/strict'
import { EasypanelSecretsProvider, readbackHasService } from '../src/lib/secrets/adapter.ts'

const provider = new EasypanelSecretsProvider()
const namespace = process.env.EASYPANEL_HOMOLOGATION_NAMESPACE
if (!namespace) throw new Error('EASYPANEL_HOMOLOGATION_NAMESPACE é obrigatória no runtime')

const { projectName, serviceName } = provider.resolveProjectAndService(namespace)
let createdByTest = false
let destroyedByTest = false

function status(step: string, value: string | boolean) {
  process.stdout.write(`${JSON.stringify({ step, status: String(value) })}\n`)
}

function actionId(readback: unknown): string | undefined {
  if (Array.isArray(readback)) {
    for (const value of readback) {
      const found = actionId(value)
      if (found) return found
    }
    return undefined
  }
  if (typeof readback !== 'object' || readback === null) return undefined
  const record = readback as Record<string, unknown>
  for (const key of ['id', 'actionId']) {
    if (typeof record[key] === 'string' && record[key]) return record[key]
  }
  for (const value of Object.values(record)) {
    const found = actionId(value)
    if (found) return found
  }
  return undefined
}

try {
  const preCheck = await provider.listProjectsAndServices()
  const existedBefore = readbackHasService(preCheck, projectName, serviceName)
  status('pre-check', existedBefore ? 'EXISTS_BEFORE_TEST' : 'ABSENT_BEFORE_TEST')
  assert.equal(existedBefore, false, 'serviço já existente não pertence a este teste')

  await provider.createAppService(projectName, serviceName)
  const afterCreate = await provider.listProjectsAndServices()
  createdByTest = readbackHasService(afterCreate, projectName, serviceName)
  status('create-readback', createdByTest ? 'CONFIRMED' : 'NOT_CONFIRMED')
  if (!createdByTest) throw new Error('readback não confirmou criação; limpeza destrutiva bloqueada')

  const marker = process.env.EASYPANEL_HOMOLOGATION_MARKER || `fbr-homologation-${Date.now()}`
  await provider.updateEnv(projectName, serviceName, { FBR_EASYPANEL_HOMOLOGATION_MARKER: marker })
  const afterUpdate = await provider.inspectAppService(projectName, serviceName)
  status('update-readback', afterUpdate ? 'RECEIVED' : 'NOT_RECEIVED')

  await provider.deploy(projectName, serviceName)
  const afterDeploy = await provider.inspectAppService(projectName, serviceName)
  status('deploy-readback', afterDeploy ? 'RECEIVED' : 'NOT_RECEIVED')

  const actions = await provider.listActions({ limit: 8, projectName, serviceName })
  status('list-actions', actions ? 'RECEIVED' : 'NOT_RECEIVED')
  const id = actionId(actions)
  if (id) {
    const action = await provider.getAction(id)
    status('get-action', action ? 'RECEIVED' : 'NOT_RECEIVED')
  } else {
    status('get-action', 'NO_ID_OBSERVED')
  }
} finally {
  if (createdByTest && !destroyedByTest) {
    const destroyed = await provider.destroy(projectName, serviceName)
    destroyedByTest = true
    status('destroy-readback', destroyed.exists ? 'STILL_PRESENT' : 'ABSENT_CONFIRMED')
    if (destroyed.exists) throw new Error('readback pós-destruição ainda confirma o serviço')
    const postDestroy = await provider.listProjectsAndServices()
    status('post-destroy-readback', readbackHasService(postDestroy, projectName, serviceName) ? 'STILL_PRESENT' : 'ABSENT_CONFIRMED')
  }
}
