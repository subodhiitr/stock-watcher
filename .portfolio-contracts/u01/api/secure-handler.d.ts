import type { PortfolioApiClock, PortfolioApiRequest, PortfolioApiResponse, PortfolioApiSecurityPolicy, PortfolioAuthorizer, AuthenticatedRateLimiter, MutationIdempotencyPort, SecurePortfolioResource, SessionAuthenticator } from './api-contracts.ts';
export declare class SecurePortfolioApi {
    private readonly authenticator;
    private readonly authorizer;
    private readonly clock;
    private readonly policy;
    private readonly rateLimiter;
    private readonly idempotency;
    constructor(authenticator: SessionAuthenticator, authorizer: PortfolioAuthorizer, clock: PortfolioApiClock, policy: PortfolioApiSecurityPolicy, rateLimiter?: AuthenticatedRateLimiter, idempotency?: MutationIdempotencyPort);
    handle<Value>(request: PortfolioApiRequest, resource: SecurePortfolioResource<Value>): Promise<PortfolioApiResponse>;
}
