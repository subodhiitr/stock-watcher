import type { PortfolioId } from '../../domain/shared/identifiers.ts'
import {
  operationsFailure,
  operationsSuccess,
  type JobDefinition,
  type JobLease,
  type JobProgress,
  type OperationsResult,
  type OperationsTrigger,
} from '../../domain/operations/contracts.ts'
import type {
  JobLeasePort,
  OperationalTask,
  OperationsClockPort,
} from '../../ports/operations/operations-port.ts'

export type JobRunOutcome = Readonly<{
  runId: string
  progress: JobProgress
}>

export class JobCoordinator {
  readonly #leases: JobLeasePort
  readonly #clock: OperationsClockPort

  constructor(
    leases: JobLeasePort,
    clock: OperationsClockPort,
  ) {
    this.#leases = leases
    this.#clock = clock
  }

  async run(
    definition: JobDefinition,
    task: OperationalTask,
    trigger: OperationsTrigger,
    portfolioId?: PortfolioId,
  ): Promise<OperationsResult<JobRunOutcome>> {
    if (!(await this.#leases.dependenciesReady(definition, portfolioId))) {
      return operationsFailure('JOB_DEPENDENCY_BLOCKED', true)
    }
    const acquiredAt = this.#clock.now()
    const request = portfolioId === undefined
      ? { definition, trigger, now: acquiredAt }
      : { definition, portfolioId, trigger, now: acquiredAt }
    const lease = await this.#leases.acquire(request)
    if (!lease) return operationsFailure('JOB_ALREADY_LEASED', true)

    const taskInput = portfolioId === undefined
      ? { runId: lease.runId, idempotencyKey: lease.leaseToken }
      : { runId: lease.runId, idempotencyKey: lease.leaseToken, portfolioId }
    let progress: JobProgress
    try {
      progress = await task.execute(taskInput)
    } catch (error) {
      const retryable = lease.attempt < definition.maxAttempts
      const resultCode = error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/u.test(error.message)
        ? error.message : 'JOB_TASK_FAILED'
      await this.#leases.fail(lease, resultCode, retryable, this.#clock.now())
      return operationsFailure('JOB_TASK_FAILED', retryable)
    }
    try {
      await this.#leases.succeed(lease, progress, this.#clock.now())
      return operationsSuccess(Object.freeze({ runId: lease.runId, progress }))
    } catch {
      await this.#leases.markRecoveryRequired(lease, this.#clock.now())
      return operationsFailure('JOB_COMPLETION_UNKNOWN')
    }
  }

  async classifyIncomplete(): Promise<readonly JobLease[]> {
    const now = this.#clock.now()
    const incomplete = await this.#leases.listIncomplete(now)
    for (const lease of incomplete) await this.#leases.markRecoveryRequired(lease, now)
    return Object.freeze([...incomplete])
  }
}
