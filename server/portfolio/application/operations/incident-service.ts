import type { Instant } from '../../domain/shared/time.ts'
import {
  operationsFailure,
  operationsSuccess,
  type IncidentRecord,
  type IncidentSeverity,
  type OperationsResult,
} from '../../domain/operations/contracts.ts'
import type { IncidentRepositoryPort } from '../../ports/operations/operations-port.ts'

export class IncidentService {
  readonly #incidents: IncidentRepositoryPort

  constructor(incidents: IncidentRepositoryPort) {
    this.#incidents = incidents
  }

  async open(input: Readonly<{
    incidentId: string
    severity: IncidentSeverity
    openedAt: Instant
    code: string
    correlationId: string
  }>): Promise<OperationsResult<IncidentRecord>> {
    if (
      !/^[A-Za-z0-9_-]{3,64}$/u.test(input.incidentId)
      || !/^[A-Z][A-Z0-9_]{2,63}$/u.test(input.code)
      || input.correlationId.length < 3
      || input.correlationId.length > 128
      || await this.#incidents.findById(input.incidentId)
    ) return operationsFailure('INCIDENT_INVALID')
    const record = Object.freeze({
      ...input,
      state: 'OPEN' as const,
      actionCodes: Object.freeze([]),
    })
    await this.#incidents.append(record)
    return operationsSuccess(record)
  }

  async close(
    current: IncidentRecord,
    closedAt: Instant,
    actionCodes: readonly string[],
  ): Promise<OperationsResult<IncidentRecord>> {
    if (
      current.state === 'CLOSED'
      || actionCodes.length === 0
      || actionCodes.some((code) => !/^[A-Z][A-Z0-9_]{2,63}$/u.test(code))
    ) return operationsFailure('INCIDENT_INVALID')
    const record: IncidentRecord = Object.freeze({
      ...current,
      state: 'CLOSED' as const,
      openedAt: current.openedAt,
      closedAt,
      actionCodes: Object.freeze([...new Set(actionCodes)].sort()),
    })
    await this.#incidents.append(record)
    return operationsSuccess(record)
  }
}
