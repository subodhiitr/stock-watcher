import {
  operationsSuccess,
  type ComponentHealth,
  type OperationsHealth,
  type OperationsResult,
} from '../../domain/operations/contracts.ts'
import type {
  HealthProbePort,
  OperationsClockPort,
} from '../../ports/operations/operations-port.ts'

export class OperationsHealthService {
  readonly #probes: readonly HealthProbePort[]
  readonly #clock: OperationsClockPort

  constructor(
    probes: readonly HealthProbePort[],
    clock: OperationsClockPort,
  ) {
    this.#probes = Object.freeze([...probes])
    this.#clock = clock
  }

  async inspect(): Promise<OperationsResult<OperationsHealth>> {
    const settled = await Promise.allSettled(this.#probes.map(async (probe) => probe.probe()))
    const checkedAt = this.#clock.now()
    const components: ComponentHealth[] = settled.map((item, index) => item.status === 'fulfilled'
      ? item.value
      : Object.freeze({
          component: `probe-${index + 1}`,
          criticality: 'CRITICAL' as const,
          state: 'BLOCKED' as const,
          checkedAt,
          code: 'PROBE_FAILED',
        }))
    const state = components.some((item) => item.criticality === 'CRITICAL' && item.state !== 'HEALTHY')
      ? 'BLOCKED'
      : components.some((item) => item.state !== 'HEALTHY') ? 'DEGRADED' : 'HEALTHY'
    return operationsSuccess(Object.freeze({
      state,
      checkedAt,
      components: Object.freeze(components),
    }))
  }
}
