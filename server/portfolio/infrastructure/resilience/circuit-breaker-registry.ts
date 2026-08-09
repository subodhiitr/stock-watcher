import { DEFAULT_CB_COOLDOWN_MS, DEFAULT_CB_FAILURE_THRESHOLD } from "../../domain/strategy/constants.ts"

export type CircuitBreakerStatus = "CLOSED" | "OPEN" | "HALF_OPEN"

type CircuitBreakerState = {
  status: CircuitBreakerStatus
  consecutiveFailures: number
  openedAt: number | undefined
  probeInFlight: boolean
}

export type ProviderHealthRecord = Readonly<{
  providerIdentity: string
  status: CircuitBreakerStatus
  consecutiveFailures: number
  openedAt: number | undefined
  lastCheckedAt: number
}>

export class CircuitBreakerRegistry {
  private readonly states = new Map<string, CircuitBreakerState>()
  private readonly failureThreshold: number
  private readonly cooldownMs: number

  constructor(failureThreshold = DEFAULT_CB_FAILURE_THRESHOLD, cooldownMs = DEFAULT_CB_COOLDOWN_MS) {
    this.failureThreshold = failureThreshold
    this.cooldownMs = cooldownMs
  }

  private getOrCreate(providerIdentity: string): CircuitBreakerState {
    let state = this.states.get(providerIdentity)
    if (!state) {
      state = { status: "CLOSED", consecutiveFailures: 0, openedAt: undefined, probeInFlight: false }
      this.states.set(providerIdentity, state)
    }
    return state
  }

  recordSuccess(providerIdentity: string): void {
    const state = this.getOrCreate(providerIdentity)
    state.consecutiveFailures = 0
    state.status = "CLOSED"
    state.probeInFlight = false
    state.openedAt = undefined
  }

  recordFailure(providerIdentity: string): void {
    const state = this.getOrCreate(providerIdentity)
    state.consecutiveFailures++
    state.probeInFlight = false
    if (state.consecutiveFailures >= this.failureThreshold && state.status !== "OPEN") {
      state.status = "OPEN"
      state.openedAt = Date.now()
    }
  }

  getStatus(providerIdentity: string): CircuitBreakerStatus {
    const state = this.getOrCreate(providerIdentity)
    if (state.status === "OPEN" && state.openedAt !== undefined) {
      if (Date.now() - state.openedAt >= this.cooldownMs) {
        state.status = "HALF_OPEN"
      }
    }
    return state.status
  }

  tryBeginProbe(providerIdentity: string): boolean {
    const state = this.getOrCreate(providerIdentity)
    const currentStatus = this.getStatus(providerIdentity)
    if (currentStatus === "HALF_OPEN" && !state.probeInFlight) {
      state.probeInFlight = true
      return true
    }
    return false
  }

  getProviderHealth(providerIdentity: string): ProviderHealthRecord {
    const state = this.getOrCreate(providerIdentity)
    return Object.freeze({
      providerIdentity,
      status: state.status,
      consecutiveFailures: state.consecutiveFailures,
      openedAt: state.openedAt,
      lastCheckedAt: Date.now(),
    })
  }

  allProviderHealth(): readonly ProviderHealthRecord[] {
    return [...this.states.keys()].map(id => this.getProviderHealth(id))
  }
}
