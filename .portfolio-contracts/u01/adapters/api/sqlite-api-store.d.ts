import type Database from 'better-sqlite3';
import type { PortfolioApiResponse } from '../../api/api-contracts.ts';
import type { IdempotencyBeginResult, PortfolioAccessRole, PortfolioApiStore, PortfolioListItem, PrincipalRecord, SessionRecord, StrategyOption } from '../../ports/api/api-store.ts';
export declare class SqlitePortfolioApiStore implements PortfolioApiStore {
    private readonly database;
    private readonly canUse;
    constructor(database: Database.Database, canUse?: () => boolean);
    private assertAvailable;
    countPrincipals(): number;
    createPrincipal(record: PrincipalRecord, createdAtEpochMs: number): boolean;
    findPrincipalByUsername(usernameKey: string): PrincipalRecord | undefined;
    findPrincipalById(principalId: string): PrincipalRecord | undefined;
    createSession(record: Readonly<{
        sessionHash: string;
        principalId: string;
        csrfHash: string;
        createdAtEpochMs: number;
        expiresAtEpochMs: number;
        mfaVerified: boolean;
    }>): boolean;
    findSession(sessionHash: string, nowEpochMs: number): SessionRecord | undefined;
    touchSession(sessionHash: string, nowEpochMs: number): void;
    invalidateSession(sessionHash: string, nowEpochMs: number): void;
    allowRateLimit(input: Readonly<{
        bucketKey: string;
        nowEpochMs: number;
        windowMs: number;
        limit: number;
        blockMs: number;
        consume?: boolean;
    }>): Readonly<{
        allowed: boolean;
        retryAfterMs: number;
    }>;
    appendSecurityAlert(input: Readonly<{
        alertId: string;
        category: 'AUTH_BRUTE_FORCE' | 'RATE_LIMIT' | 'SESSION_REJECTED';
        subjectHash: string;
        detailCode: string;
        createdAtEpochMs: number;
    }>): void;
    grantPortfolioAccess(principalId: string, portfolioId: string, role: PortfolioAccessRole, createdAtEpochMs: number): boolean;
    grantAllExistingPortfolios(principalId: string, createdAtEpochMs: number): void;
    canAccessPortfolio(principalId: string, portfolioId: string, access: string): boolean;
    listPortfolios(principalId: string): readonly PortfolioListItem[];
    listStrategyOptions(): readonly StrategyOption[];
    beginIdempotency(input: Readonly<{
        principalId: string;
        idempotencyKey: string;
        requestHash: string;
        nowEpochMs: number;
        expiresAtEpochMs: number;
    }>): IdempotencyBeginResult;
    completeIdempotency(input: Readonly<{
        principalId: string;
        idempotencyKey: string;
        requestHash: string;
        response: PortfolioApiResponse;
    }>): void;
    abandonIdempotency(principalId: string, idempotencyKey: string, requestHash: string): void;
    readPortfolioView(principalId: string, portfolioId: string): unknown | undefined;
    listSecurityAlerts(limit: number): readonly unknown[];
}
