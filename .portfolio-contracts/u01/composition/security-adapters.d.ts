import type { AuthenticatedRateLimiter, AuthenticatedSession, MutationIdempotencyPort, PortfolioApiRequest, PortfolioAuthorizer, SessionAuthenticator } from '../api/api-contracts.ts';
import type { PortfolioApiStore } from '../ports/api/api-store.ts';
export declare function passwordDigest(password: string, saltHex: string): string;
export type LoginResult = Readonly<{
    ok: true;
    sessionToken: string;
    csrfToken: string;
    expiresAtEpochMs: number;
}> | Readonly<{
    ok: false;
    status: 401 | 429;
    retryAfterSeconds?: number;
}>;
export declare class PortfolioAuthenticationService {
    private readonly store;
    private readonly now;
    constructor(store: PortfolioApiStore, now: () => number);
    bootstrap(input: Readonly<{
        username?: string;
        password?: string;
        displayName?: string;
        mfaSecret?: string;
    }>): boolean;
    login(input: Readonly<{
        username: string;
        password: string;
        mfaCode?: string;
        clientSubject: string;
    }>): LoginResult;
    logout(request: PortfolioApiRequest): void;
    static cookie(sessionToken: string, secure: boolean): string;
    static expiredCookie(secure: boolean): string;
    static csrfCookie(csrfToken: string, secure: boolean): string;
    static expiredCsrfCookie(secure: boolean): string;
}
export declare class SqliteSessionAuthenticator implements SessionAuthenticator {
    private readonly store;
    private readonly now;
    constructor(store: PortfolioApiStore, now: () => number);
    authenticate(request: PortfolioApiRequest): Promise<AuthenticatedSession | null>;
}
export declare class SqlitePortfolioAuthorizer implements PortfolioAuthorizer {
    private readonly store;
    constructor(store: PortfolioApiStore);
    canAccess(input: Parameters<PortfolioAuthorizer['canAccess']>[0]): Promise<boolean>;
}
export declare class SqliteAuthenticatedRateLimiter implements AuthenticatedRateLimiter {
    private readonly store;
    private readonly now;
    constructor(store: PortfolioApiStore, now: () => number);
    allow(session: AuthenticatedSession): Promise<Readonly<{
        allowed: boolean;
        retryAfterSeconds?: number;
    }>>;
}
export declare class SqliteMutationIdempotency implements MutationIdempotencyPort {
    private readonly store;
    private readonly now;
    constructor(store: PortfolioApiStore, now: () => number);
    begin(input: Parameters<MutationIdempotencyPort['begin']>[0]): Promise<import("../ports/api/api-store.ts").IdempotencyBeginResult>;
    complete(input: Parameters<MutationIdempotencyPort['complete']>[0]): Promise<void>;
    abandon(input: Parameters<MutationIdempotencyPort['abandon']>[0]): Promise<void>;
}
export declare function csrfMatches(stored: string, supplied: string): boolean;
