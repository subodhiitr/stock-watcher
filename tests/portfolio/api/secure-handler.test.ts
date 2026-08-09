import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SecurePortfolioApi,
  type AuthenticatedSession,
  type PortfolioApiRequest,
  type SecurePortfolioResource,
} from '../../../server/portfolio/api.ts'
import {
  parseActorId,
  parsePortfolioId,
} from '../../../server/portfolio/domain/shared/identifiers.ts'

const actor = parseActorId('actor-priya')
const portfolio = parsePortfolioId('portfolio-priya')
if (!actor.ok) throw new Error('Invalid test actor identifier')
if (!portfolio.ok) throw new Error('Invalid test portfolio identifier')
const actorId = actor.value
const portfolioId = portfolio.value

const validSession: AuthenticatedSession = Object.freeze({
  sessionId: 'session-1',
  actorId,
  expiresAtEpochMs: 2_000,
  csrfToken: 'csrf-1',
  mfaVerified: false,
})

function request(overrides: Partial<PortfolioApiRequest> = {}): PortfolioApiRequest {
  return {
    method: 'GET',
    path: '/portfolio/portfolio-priya',
    headers: {},
    portfolioId,
    ...overrides,
  }
}

function resource<Value = unknown>(
  overrides: Partial<SecurePortfolioResource<Value>> = {},
): SecurePortfolioResource<Value> {
  return {
    access: 'READ',
    async handle() {
      return { status: 200, headers: {}, body: { ok: true } }
    },
    ...overrides,
  }
}

function api(options: Readonly<{
  session?: AuthenticatedSession | null
  allowed?: boolean
  onAuthorize?: () => void
}> = {}): SecurePortfolioApi {
  return new SecurePortfolioApi(
    { async authenticate() { return options.session === undefined ? validSession : options.session } },
    {
      async canAccess() {
        options.onAuthorize?.()
        return options.allowed ?? true
      },
    },
    { nowEpochMs() { return 1_000 } },
    { allowedOrigins: ['https://app.local'], maxPayloadBytes: 64, hsts: true },
  )
}

test('authentication and exact portfolio authorization run before resource access', async () => {
  let authorizationCalls = 0
  let handlerCalls = 0
  const handler = resource({ async handle() { handlerCalls += 1; return { status: 200, headers: {}, body: {} } } })

  const unauthenticated = await api({ session: null, onAuthorize: () => { authorizationCalls += 1 } })
    .handle(request(), handler)
  assert.equal(unauthenticated.status, 401)
  assert.equal(authorizationCalls, 0)
  assert.equal(handlerCalls, 0)

  const forbidden = await api({ allowed: false, onAuthorize: () => { authorizationCalls += 1 } })
    .handle(request({ portfolioId: 'portfolio-someone-else' }), handler)
  assert.equal(forbidden.status, 403)
  assert.equal(authorizationCalls, 1)
  assert.equal(handlerCalls, 0)

  const invalidIdentifier = await api().handle(request({ portfolioId: '../fallback' }), handler)
  assert.equal(invalidIdentifier.status, 403)
  assert.equal(handlerCalls, 0)
})

test('expired sessions and privileged requests without MFA fail closed', async () => {
  const expired = await api({ session: { ...validSession, expiresAtEpochMs: 1_000 } })
    .handle(request(), resource())
  assert.equal(expired.status, 401)

  const withoutMfa = await api().handle(request(), resource({ access: 'PRIVILEGED' }))
  assert.equal(withoutMfa.status, 403)
})

test('mutations require allowed origin, CSRF, correlation, and idempotency evidence', async () => {
  let contextSeen: unknown
  const mutation = resource<{ name: string }>({
    access: 'MUTATE',
    mutation: true,
    schema: {
      parse(value) {
        return typeof value === 'object' && value !== null && (value as { name?: unknown }).name === 'Paper'
          ? { ok: true, value: { name: 'Paper' } }
          : { ok: false }
      },
    },
    async handle(context) {
      contextSeen = context
      return { status: 204, headers: {}, body: null }
    },
  })

  const missingOrigin = await api().handle(request({ method: 'POST', bodyText: '{"name":"Paper"}' }), mutation)
  assert.equal(missingOrigin.status, 403)

  const rejectedOrigin = await api().handle(request({
    method: 'POST',
    headers: { origin: 'https://attacker.invalid' },
    bodyText: '{"name":"Paper"}',
  }), mutation)
  assert.equal(rejectedOrigin.status, 403)

  const protectedHeaders = {
    origin: 'https://app.local',
    'x-csrf-token': 'csrf-1',
    'x-correlation-id': 'correlation-1',
    'idempotency-key': 'mutation-1',
  }
  const missingIdempotency = await api().handle(request({
    method: 'POST',
    headers: { ...protectedHeaders, 'idempotency-key': undefined },
    bodyText: '{"name":"Paper"}',
  }), mutation)
  assert.equal(missingIdempotency.status, 409)

  const badCsrf = await api().handle(request({
    method: 'POST',
    headers: { ...protectedHeaders, 'x-csrf-token': 'wrong' },
    bodyText: '{"name":"Paper"}',
  }), mutation)
  assert.equal(badCsrf.status, 403)

  const accepted = await api().handle(request({
    method: 'POST',
    headers: protectedHeaders,
    bodyText: '{"name":"Paper"}',
  }), mutation)
  assert.equal(accepted.status, 204)
  assert.equal(accepted.headers['x-correlation-id'], 'correlation-1')
  assert.deepEqual(contextSeen, {
    session: validSession,
    portfolioId,
    correlationId: 'correlation-1',
    idempotencyKey: 'mutation-1',
    input: { name: 'Paper' },
  })
})

test('bounded JSON and schema validation reject malformed input', async () => {
  const schema = { parse(value: unknown) { return value === 7 ? { ok: true as const, value } : { ok: false as const } } }
  const secured = resource<number>({ schema })

  assert.equal((await api().handle(request({ bodyText: 'x'.repeat(65) }), secured)).status, 413)
  assert.equal((await api().handle(request({ bodyText: '{' }), secured)).status, 400)
  assert.equal((await api().handle(request({ bodyText: '8' }), secured)).status, 400)
  assert.equal((await api().handle(request({ bodyText: '7' }), secured)).status, 200)
})

test('unexpected failures return stable redacted errors', async () => {
  const response = await api().handle(request(), resource({
    async handle() { throw new Error('database password at C:\\private\\db.sqlite') },
  }))
  const encoded = JSON.stringify(response)
  assert.equal(response.status, 500)
  assert.match(encoded, /INTERNAL_ERROR/u)
  assert.doesNotMatch(encoded, /password|private|sqlite|stack/u)
})

test('HTML responses include restrictive security headers', async () => {
  const response = await api().handle(request(), resource({ htmlResponse: true }))
  assert.equal(response.headers['x-content-type-options'], 'nosniff')
  assert.equal(response.headers['x-frame-options'], 'DENY')
  assert.equal(response.headers['referrer-policy'], 'no-referrer')
  assert.match(response.headers['content-security-policy'] ?? '', /frame-ancestors 'none'/u)
  assert.match(response.headers['strict-transport-security'] ?? '', /max-age=/u)
})
