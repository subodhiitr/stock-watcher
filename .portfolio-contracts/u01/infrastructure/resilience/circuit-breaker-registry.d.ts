export type CircuitBreakerStatus = "CLOSED" | "OPEN" | "HALF_OPEN";
export type ProviderHealthRecord = Readonly<{
    providerIdentity: string;
    status: CircuitBreakerStatus;
    consecutiveFailures: number;
    openedAt: number | undefined;
    lastCheckedAt: number;
}>;
export declare class CircuitBreakerRegistry {
    private readonly states;
    private readonly failureThreshold;
    private readonly cooldownMs;
    constructor(failureThreshold?: number, cooldownMs?: number);
    private getOrCreate;
    recordSuccess(providerIdentity: string): void;
    recordFailure(providerIdentity: string): void;
    getStatus(providerIdentity: string): CircuitBreakerStatus;
    tryBeginProbe(providerIdentity: string): boolean;
    getProviderHealth(providerIdentity: string): ProviderHealthRecord;
    allProviderHealth(): readonly ProviderHealthRecord[];
}
