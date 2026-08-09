import { DEFAULT_MAX_RETRIES, DEFAULT_PROVIDER_DEADLINE_MS } from "../../domain/strategy/constants.ts"
import { domainFailure } from "../../domain/errors/failure.ts"
import { failure, type DomainResult } from "../../domain/errors/result.ts"
import type { CircuitBreakerRegistry } from "./circuit-breaker-registry.ts"
import type { CredentialRedactor } from "./credential-redactor.ts"

export type ProviderResilienceConfig = Readonly<{
  deadlineMs?: number
  maxRetries?: number
  baseBackoffMs?: number
  jitterMaxMs?: number
}>

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class ProviderResilienceWrapper {
  private readonly circuitBreakerRegistry: CircuitBreakerRegistry
  private readonly credentialRedactor: CredentialRedactor
  private readonly deadlineMs: number
  private readonly maxRetries: number
  private readonly baseBackoffMs: number
  private readonly jitterMaxMs: number

  constructor(
    circuitBreakerRegistry: CircuitBreakerRegistry,
    credentialRedactor: CredentialRedactor,
    config: ProviderResilienceConfig = {},
  ) {
    this.circuitBreakerRegistry = circuitBreakerRegistry
    this.credentialRedactor = credentialRedactor
    this.deadlineMs = config.deadlineMs ?? DEFAULT_PROVIDER_DEADLINE_MS
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES
    this.baseBackoffMs = config.baseBackoffMs ?? 500
    this.jitterMaxMs = config.jitterMaxMs ?? 200
  }

  async call<T>(
    providerIdentity: string,
    callFn: (signal: AbortSignal) => Promise<T>,
  ): Promise<DomainResult<T>> {
    const circuitStatus = this.circuitBreakerRegistry.getStatus(providerIdentity)

    if (circuitStatus === "OPEN") {
      return failure(domainFailure("CIRCUIT_OPEN", {
        retryability: "AFTER_STATE_REFRESH",
        field: "providerIdentity",
        context: { providerIdentity: providerIdentity.slice(0, 40) },
      }))
    }

    if (circuitStatus === "HALF_OPEN") {
      const probeStarted = this.circuitBreakerRegistry.tryBeginProbe(providerIdentity)
      if (!probeStarted) {
        return failure(domainFailure("CIRCUIT_OPEN", {
          retryability: "AFTER_STATE_REFRESH",
          field: "providerIdentity",
        }))
      }
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.deadlineMs)

      try {
        const result = await callFn(controller.signal)
        clearTimeout(timeoutId)
        this.circuitBreakerRegistry.recordSuccess(providerIdentity)
        return { ok: true as const, value: result }
      } catch (_err) {
        clearTimeout(timeoutId)
        this.circuitBreakerRegistry.recordFailure(providerIdentity)

        const newStatus = this.circuitBreakerRegistry.getStatus(providerIdentity)
        if (newStatus === "OPEN") {
          return failure(domainFailure("CIRCUIT_OPEN", {
            retryability: "AFTER_STATE_REFRESH",
            field: "providerIdentity",
          }))
        }

        if (attempt < this.maxRetries) {
          const backoff = this.baseBackoffMs * Math.pow(2, attempt)
          const jitter = Math.floor(Math.random() * this.jitterMaxMs)
          await delay(backoff + jitter)
        }
      }
    }

    return failure(domainFailure("PROVIDER_UNAVAILABLE", {
      retryability: "AFTER_STATE_REFRESH",
      field: "providerIdentity",
      context: { providerIdentity: providerIdentity.slice(0, 40) },
    }))
  }
}
