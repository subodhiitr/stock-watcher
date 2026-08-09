import type { PortfolioApiResponse } from '../../api/api-contracts.ts';
export type PrincipalRole = 'INVESTOR' | 'OPERATOR' | 'ADMIN';
export type PortfolioAccessRole = 'VIEWER' | 'EDITOR' | 'OWNER';
export type PrincipalRecord = Readonly<{
    principalId: string;
    usernameKey: string;
    displayName: string;
    passwordSalt: string;
    passwordHash: string;
    globalRole: PrincipalRole;
    mfaSecret?: string;
    disabled: boolean;
}>;
export type SessionRecord = Readonly<{
    sessionHash: string;
    principalId: string;
    actorId: string;
    csrfHash: string;
    expiresAtEpochMs: number;
    mfaVerified: boolean;
    invalidated: boolean;
}>;
export type PortfolioListItem = Readonly<{
    portfolioId: string;
    displayName: string;
    status: string;
    mode: string;
    cashMinorUnits: string;
    stateVersion: number;
    accessRole: PortfolioAccessRole;
}>;
export type StrategyOption = Readonly<{
    strategyVersionId: string;
    displayName: string;
    horizon: string;
    semanticVersion: string;
}>;
export type IdempotencyBeginResult = Readonly<{
    kind: 'NEW';
}> | Readonly<{
    kind: 'CONFLICT' | 'IN_PROGRESS';
}> | Readonly<{
    kind: 'REPLAY';
    response: PortfolioApiResponse;
}>;
export interface PortfolioApiStore {
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
