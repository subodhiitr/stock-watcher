import {
  parseActorId,
  parseCorrelationId,
  parseIdempotencyKey,
  parsePortfolioId,
  type CorrelationId,
  type IdempotencyKey,
} from '../domain/shared/identifiers.ts'
import type {
  AuthenticatedSession,
  PortfolioApiClock,
  PortfolioApiRequest,
  PortfolioApiResponse,
  PortfolioApiSecurityPolicy,
  PortfolioAuthorizer,
  AuthenticatedRateLimiter,
  MutationIdempotencyPort,
  SecurePortfolioResource,
  SessionAuthenticator,
} from './api-contracts.ts'
import { portfolioHtmlSecurityHeaders } from './security-headers.ts'
import { createHash } from 'node:crypto'

type ApiErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'ACCESS_DENIED'
  | 'INVALID_REQUEST'
  | 'REQUEST_TOO_LARGE'
  | 'REQUEST_CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'

const MAX_SESSION_EVIDENCE_LENGTH = 256

function header(request: PortfolioApiRequest, name: string): string | undefined {
  const expected = name.toLowerCase()
  for (const [key, value] of Object.entries(request.headers)) {
    if (key.toLowerCase() === expected) return value
  }
  return undefined
}

function isSameHostOrigin(host: string | undefined, origin: string | undefined): boolean {
  if (host === undefined || origin === undefined || origin === 'null') return false
  try {
    const parsed = new URL(origin)
    const hostValue = host.toLowerCase()
    const originHost = parsed.host.toLowerCase()
    if (hostValue === originHost) return true
    const defaultPort = parsed.protocol === 'https:' ? '443' : parsed.protocol === 'http:' ? '80' : ''
    return defaultPort !== ''
      && originHost === `${parsed.hostname.toLowerCase()}:${defaultPort}`
      && hostValue === parsed.hostname.toLowerCase()
  } catch {
    return false
  }
}

function isAllowedRequestOrigin(request: PortfolioApiRequest, allowedOrigins: readonly string[], origin: string): boolean {
  return allowedOrigins.includes(origin) || isSameHostOrigin(header(request, 'host'), origin)
}

function constantTimeEqual(left: string, right: string): boolean {
  if (right.startsWith('sha256:')) {
    const digest = createHash('sha256').update(left, 'utf8').digest('hex')
    return constantTimeEqual(digest, right.slice(7))
  }
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return difference === 0
}

function validSession(session: AuthenticatedSession, nowEpochMs: number): boolean {
  return session.sessionId.length > 0
    && session.sessionId.length <= MAX_SESSION_EVIDENCE_LENGTH
    && session.csrfToken.length > 0
    && session.csrfToken.length <= MAX_SESSION_EVIDENCE_LENGTH
    && parseActorId(session.actorId).ok
    && Number.isSafeInteger(session.expiresAtEpochMs)
    && session.expiresAtEpochMs > nowEpochMs
}

function safeError(
  status: number,
  code: ApiErrorCode,
  headers: Readonly<Record<string, string>>,
): PortfolioApiResponse {
  return Object.freeze({
    status,
    headers,
    body: Object.freeze({ error: Object.freeze({ code, message: 'Request could not be processed' }) }),
  })
}

export class SecurePortfolioApi {
  private readonly authenticator: SessionAuthenticator
  private readonly authorizer: PortfolioAuthorizer
  private readonly clock: PortfolioApiClock
  private readonly policy: PortfolioApiSecurityPolicy
  private readonly rateLimiter: AuthenticatedRateLimiter | undefined
  private readonly idempotency: MutationIdempotencyPort | undefined

  constructor(
    authenticator: SessionAuthenticator,
    authorizer: PortfolioAuthorizer,
    clock: PortfolioApiClock,
    policy: PortfolioApiSecurityPolicy,
    rateLimiter?: AuthenticatedRateLimiter,
    idempotency?: MutationIdempotencyPort,
  ) {
    if (!Number.isSafeInteger(policy.maxPayloadBytes) || policy.maxPayloadBytes < 1) {
      throw new Error('Invalid API security policy')
    }
    this.authenticator = authenticator
    this.authorizer = authorizer
    this.clock = clock
    this.policy = policy
    this.rateLimiter = rateLimiter
    this.idempotency = idempotency
    if (policy.requireDurableIdempotency === true && idempotency === undefined) {
      throw new Error('Durable idempotency port required')
    }
  }

  async handle<Value>(
    request: PortfolioApiRequest,
    resource: SecurePortfolioResource<Value>,
  ): Promise<PortfolioApiResponse> {
    const responseHeaders: Record<string, string> = { 'cache-control': 'no-store' }
    let reserved: Readonly<{
      session: AuthenticatedSession
      idempotencyKey: IdempotencyKey
      requestFingerprint: string
    }> | undefined
    if (resource.htmlResponse) {
      Object.assign(responseHeaders, portfolioHtmlSecurityHeaders(this.policy.hsts))
    }

    try {
      const origin = header(request, 'origin')
      if (origin !== undefined) {
        if (!isAllowedRequestOrigin(request, this.policy.allowedOrigins, origin)) {
          return safeError(403, 'ACCESS_DENIED', Object.freeze(responseHeaders))
        }
        responseHeaders['access-control-allow-origin'] = origin
        responseHeaders.vary = 'Origin'
      }

      const session = await this.authenticator.authenticate(request)
      if (session === null || !validSession(session, this.clock.nowEpochMs())) {
        return safeError(401, 'AUTHENTICATION_REQUIRED', Object.freeze(responseHeaders))
      }
      const rate = await this.rateLimiter?.allow(session)
      if (rate !== undefined && !rate.allowed) {
        if (rate.retryAfterSeconds !== undefined) {
          responseHeaders['retry-after'] = String(rate.retryAfterSeconds)
        }
        return safeError(429, 'RATE_LIMITED', Object.freeze(responseHeaders))
      }

      const portfolioId = parsePortfolioId(request.portfolioId)
      if (!portfolioId.ok) {
        return safeError(403, 'ACCESS_DENIED', Object.freeze(responseHeaders))
      }

      const requiredAccess = resource.mutation && resource.access === 'READ'
        ? 'MUTATE'
        : resource.access
      const allowed = await this.authorizer.canAccess({
        actorId: session.actorId,
        portfolioId: portfolioId.value,
        access: requiredAccess,
      })
      if (!allowed) {
        return safeError(403, 'ACCESS_DENIED', Object.freeze(responseHeaders))
      }

      if (resource.access === 'PRIVILEGED' && !session.mfaVerified) {
        return safeError(403, 'ACCESS_DENIED', Object.freeze(responseHeaders))
      }

      const payloadBytes = request.bodyText === undefined
        ? 0
        : Buffer.byteLength(request.bodyText, 'utf8')
      if (payloadBytes > this.policy.maxPayloadBytes) {
        return safeError(413, 'REQUEST_TOO_LARGE', Object.freeze(responseHeaders))
      }

      let correlationId: CorrelationId | undefined
      let idempotencyKey: IdempotencyKey | undefined
      if (resource.mutation) {
        if (origin === undefined) {
          return safeError(403, 'ACCESS_DENIED', Object.freeze(responseHeaders))
        }
        const csrfToken = header(request, 'x-csrf-token')
        if (csrfToken === undefined || !constantTimeEqual(csrfToken, session.csrfToken)) {
          return safeError(403, 'ACCESS_DENIED', Object.freeze(responseHeaders))
        }
        const parsedCorrelation = parseCorrelationId(header(request, 'x-correlation-id'))
        const parsedIdempotency = parseIdempotencyKey(header(request, 'idempotency-key'))
        if (!parsedCorrelation.ok || !parsedIdempotency.ok) {
          return safeError(409, 'REQUEST_CONFLICT', Object.freeze(responseHeaders))
        }
        correlationId = parsedCorrelation.value
        idempotencyKey = parsedIdempotency.value
        responseHeaders['x-correlation-id'] = correlationId
      }

      let decoded: unknown = undefined
      if (request.bodyText !== undefined) {
        try {
          decoded = JSON.parse(request.bodyText) as unknown
        } catch {
          return safeError(400, 'INVALID_REQUEST', Object.freeze(responseHeaders))
        }
      }
      const parsed = resource.schema?.parse(decoded)
      if (parsed !== undefined && !parsed.ok) {
        return safeError(400, 'INVALID_REQUEST', Object.freeze(responseHeaders))
      }

      if (resource.mutation && idempotencyKey !== undefined && this.idempotency !== undefined) {
        const requestFingerprint = request.requestFingerprint
        if (requestFingerprint === undefined || !/^[a-f0-9]{64}$/u.test(requestFingerprint)) {
          return safeError(409, 'REQUEST_CONFLICT', Object.freeze(responseHeaders))
        }
        const started = await this.idempotency.begin({
          session,
          idempotencyKey,
          requestFingerprint,
        })
        if (started.kind === 'REPLAY') {
          return Object.freeze({
            ...started.response,
            headers: Object.freeze({ ...started.response.headers, ...responseHeaders }),
          })
        }
        if (started.kind !== 'NEW') {
          return safeError(409, 'REQUEST_CONFLICT', Object.freeze(responseHeaders))
        }
        reserved = Object.freeze({ session, idempotencyKey, requestFingerprint })
      } else if (resource.mutation && this.policy.requireDurableIdempotency === true) {
        return safeError(409, 'REQUEST_CONFLICT', Object.freeze(responseHeaders))
      }

      const result = await resource.handle({
        session,
        portfolioId: portfolioId.value,
        ...(correlationId === undefined ? {} : { correlationId }),
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        input: parsed?.ok === true ? parsed.value : decoded as Value,
      })
      const securedResult = Object.freeze({
        status: result.status,
        body: result.body,
        headers: Object.freeze({ ...result.headers, ...responseHeaders }),
      })
      if (reserved !== undefined && this.idempotency !== undefined) {
        await this.idempotency.complete({ ...reserved, response: securedResult })
        reserved = undefined
      }
      return securedResult
    } catch {
      if (reserved !== undefined && this.idempotency !== undefined) {
        try {
          await this.idempotency.abandon(reserved)
        } catch {
          // The durable IN_PROGRESS record intentionally contains an uncertain mutation.
        }
      }
      return safeError(500, 'INTERNAL_ERROR', Object.freeze(responseHeaders))
    }
  }
}
