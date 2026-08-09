import type { ActorId, CorrelationId, IdempotencyKey, PortfolioId } from '../domain/shared/identifiers.ts';
export type PortfolioApiAccess = 'READ' | 'MUTATE' | 'PRIVILEGED';
export type PortfolioApiRequest = Readonly<{
    method: string;
    path: string;
    headers: Readonly<Record<string, string | undefined>>;
    portfolioId: unknown;
    bodyText?: string;
    requestFingerprint?: string;
}>;
export type AuthenticatedSession = Readonly<{
    sessionId: string;
    actorId: ActorId;
    expiresAtEpochMs: number;
    csrfToken: string;
    mfaVerified: boolean;
}>;
export type SessionAuthenticator = Readonly<{
    authenticate(request: PortfolioApiRequest): Promise<AuthenticatedSession | null>;
}>;
export type PortfolioAuthorizer = Readonly<{
    canAccess(input: Readonly<{
        actorId: ActorId;
        portfolioId: PortfolioId;
        access: PortfolioApiAccess;
    }>): Promise<boolean>;
}>;
export type PortfolioApiClock = Readonly<{
    nowEpochMs(): number;
}>;
export type RequestSchemaResult<Value> = Readonly<{
    ok: true;
    value: Value;
}> | Readonly<{
    ok: false;
}>;
export type RequestSchema<Value> = Readonly<{
    parse(value: unknown): RequestSchemaResult<Value>;
}>;
export type PortfolioApiContext<Value> = Readonly<{
    session: AuthenticatedSession;
    portfolioId: PortfolioId;
    correlationId?: CorrelationId;
    idempotencyKey?: IdempotencyKey;
    input: Value;
}>;
export type PortfolioApiResponse = Readonly<{
    status: number;
    headers: Readonly<Record<string, string>>;
    body: unknown;
}>;
export type PortfolioApiHandler<Value> = (context: PortfolioApiContext<Value>) => Promise<PortfolioApiResponse>;
export type SecurePortfolioResource<Value> = Readonly<{
    access: PortfolioApiAccess;
    mutation?: boolean;
    htmlResponse?: boolean;
    schema?: RequestSchema<Value>;
    handle: PortfolioApiHandler<Value>;
}>;
export type PortfolioApiSecurityPolicy = Readonly<{
    allowedOrigins: readonly string[];
    maxPayloadBytes: number;
    hsts: boolean;
    requireDurableIdempotency?: boolean;
}>;
export type AuthenticatedRateLimiter = Readonly<{
    allow(session: AuthenticatedSession): Promise<Readonly<{
        allowed: boolean;
        retryAfterSeconds?: number;
    }>>;
}>;
export type MutationIdempotencyPort = Readonly<{
    begin(input: Readonly<{
        session: AuthenticatedSession;
        idempotencyKey: IdempotencyKey;
        requestFingerprint: string;
    }>): Promise<Readonly<{
        kind: 'NEW';
    }> | Readonly<{
        kind: 'CONFLICT' | 'IN_PROGRESS';
    }> | Readonly<{
        kind: 'REPLAY';
        response: PortfolioApiResponse;
    }>>;
    complete(input: Readonly<{
        session: AuthenticatedSession;
        idempotencyKey: IdempotencyKey;
        requestFingerprint: string;
        response: PortfolioApiResponse;
    }>): Promise<void>;
    abandon(input: Readonly<{
        session: AuthenticatedSession;
        idempotencyKey: IdempotencyKey;
        requestFingerprint: string;
    }>): Promise<void>;
}>;
