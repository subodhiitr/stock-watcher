import { type DomainResult } from "../../domain/errors/result.ts";
import type { CircuitBreakerRegistry } from "./circuit-breaker-registry.ts";
import type { CredentialRedactor } from "./credential-redactor.ts";
export type ProviderResilienceConfig = Readonly<{
    deadlineMs?: number;
    maxRetries?: number;
    baseBackoffMs?: number;
    jitterMaxMs?: number;
}>;
export declare class ProviderResilienceWrapper {
    private readonly circuitBreakerRegistry;
    private readonly credentialRedactor;
    private readonly deadlineMs;
    private readonly maxRetries;
    private readonly baseBackoffMs;
    private readonly jitterMaxMs;
    constructor(circuitBreakerRegistry: CircuitBreakerRegistry, credentialRedactor: CredentialRedactor, config?: ProviderResilienceConfig);
    call<T>(providerIdentity: string, callFn: (signal: AbortSignal) => Promise<T>): Promise<DomainResult<T>>;
}
