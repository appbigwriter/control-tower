// GDB-REM-011: saga executor with compensating actions.
// Sequential by design — no Promise.all for state-mutating steps, so every
// intermediate state is documented and reconcilable when a later step fails.

export interface SagaStep<T = unknown> {
  name: string
  execute: () => Promise<T>
  /** Best-effort rollback executed (in reverse order) when a later step fails. */
  compensate?: (result: T, failureReason: unknown) => Promise<void>
}

export interface SagaExecutedStep {
  step: string
  ok: boolean
}

export interface SagaCompensationEntry {
  step: string
  ok: boolean
  error: string | null
}

export interface SagaReceipt {
  saga: string
  status: 'completed' | 'failed' | 'compensation_failed'
  executed: SagaExecutedStep[]
  failedStep: string | null
  error: string | null
  compensation: SagaCompensationEntry[]
  finishedAt: string
}

/** Sanitize an unknown error into a bounded, log-safe message. */
export function sanitizeError(error: unknown, maxLen = 300): string | null {
  if (error === null || error === undefined) return null
  let message: string
  if (error instanceof Error) message = error.message
  else if (typeof error === 'object' && error !== null && 'message' in error) {
    message = String((error as { message: unknown }).message)
  } else {
    message = String(error)
  }
  const oneLine = message.replace(/\s+/g, ' ').trim()
  if (!oneLine) return null
  return oneLine.slice(0, maxLen)
}

export async function runSaga(
  sagaName: string,
  steps: SagaStep[],
): Promise<SagaReceipt> {
  const executed: SagaExecutedStep[] = []
  const compensation: SagaCompensationEntry[] = []
  const completed: Array<{ step: SagaStep; result: unknown }> = []
  let failedStep: string | null = null
  let error: string | null = null
  let status: SagaReceipt['status'] = 'completed'

  for (const step of steps) {
    try {
      const result = await step.execute()
      completed.push({ step, result })
      executed.push({ step: step.name, ok: true })
    } catch (err) {
      failedStep = step.name
      error = sanitizeError(err)
      executed.push({ step: step.name, ok: false })
      status = 'failed'
      break
    }
  }

  if (status === 'failed' && completed.length > 0) {
    // Compensate in reverse order; compensation errors never mask the original failure.
    let compensationFailed = false
    for (const { step, result } of completed.slice().reverse()) {
      if (!step.compensate) continue
      try {
        await step.compensate(result, error)
        compensation.push({ step: step.name, ok: true, error: null })
      } catch (compErr) {
        compensationFailed = true
        compensation.push({
          step: step.name,
          ok: false,
          error: sanitizeError(compErr),
        })
      }
    }
    if (compensationFailed) status = 'compensation_failed'
  }

  return {
    saga: sagaName,
    status,
    executed,
    failedStep,
    error,
    compensation,
    finishedAt: new Date().toISOString(),
  }
}

/** True only when every step succeeded. Never trust a receipt with failedStep set. */
export function sagaSucceeded(receipt: SagaReceipt): boolean {
  return receipt.status === 'completed' && receipt.failedStep === null
}
