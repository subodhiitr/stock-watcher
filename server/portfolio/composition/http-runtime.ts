import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type * as http from 'node:http'

import { SecurePortfolioApi } from '../api/secure-handler.ts'
import type {
  PortfolioApiRequest,
  PortfolioApiResponse,
  RequestSchema,
  SecurePortfolioResource,
} from '../api/api-contracts.ts'
import { PortfolioApiApplicationService } from '../application/api/portfolio-api-service.ts'
import type { ResearchMarketQuoteProvider } from '../application/api/portfolio-api-service.ts'
import type { ResearchMarketAnalysisProvider } from '../application/api/research-candidate-selection.ts'
import { success } from '../domain/errors/result.ts'
import type { Instant } from '../domain/shared/time.ts'
import {
  defaultPortfolioDatabaseConfiguration,
  type PortfolioDatabaseConfiguration,
} from '../infrastructure/persistence/configuration.ts'
import {
  TemporaryTestEncryptionAttestation,
  type EncryptionAttestationPort,
  type EncryptionProtection,
} from '../infrastructure/persistence/encryption-attestation.ts'
import {
  openPortfolioDatabase,
  type PortfolioDatabaseOwner,
} from '../infrastructure/persistence/database-owner.ts'
import {
  PortfolioAuthenticationService,
  SqliteAuthenticatedRateLimiter,
  SqliteMutationIdempotency,
  SqlitePortfolioAuthorizer,
  SqliteSessionAuthenticator,
} from './security-adapters.ts'

const MAX_BODY_BYTES = 64 * 1_024
const SAFE_JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
})

class ConfiguredEncryptionAttestation implements EncryptionAttestationPort {
  private readonly protection: EncryptionProtection
  private readonly now: () => Instant

  constructor(protection: EncryptionProtection, now: () => Instant) {
    this.protection = protection
    this.now = now
  }

  attest() {
    return success(Object.freeze({
      protected: true as const,
      protection: this.protection,
      attestedAt: this.now(),
    }))
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function toHeaderRecord(headers: http.IncomingHttpHeaders): Readonly<Record<string, string | undefined>> {
  const record: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(headers)) {
    record[key] = Array.isArray(value) ? value.join(', ') : value
  }
  return Object.freeze(record)
}

async function readBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += value.byteLength
    if (length > MAX_BODY_BYTES) throw new Error('REQUEST_TOO_LARGE')
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function write(response: http.ServerResponse, result: PortfolioApiResponse): void {
  const headers: Record<string, string | string[]> = { ...SAFE_JSON_HEADERS, ...result.headers }
  if (typeof headers['set-cookie'] === 'string' && headers['set-cookie'].includes('|||')) {
    headers['set-cookie'] = headers['set-cookie'].split('|||')
  }
  response.writeHead(result.status, headers)
  response.end(JSON.stringify(result.body))
}

function generic(status: number, code: string): PortfolioApiResponse {
  return Object.freeze({
    status,
    headers: SAFE_JSON_HEADERS,
    body: Object.freeze({ error: Object.freeze({ code, message: 'Request could not be processed' }) }),
  })
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

function isAllowedRequestOrigin(
  headers: http.IncomingHttpHeaders,
  allowedOrigins: readonly string[],
  origin: string | undefined,
): origin is string {
  return origin !== undefined
    && (allowedOrigins.includes(origin) || isSameHostOrigin(headers.host, origin))
}

function objectSchema<Value>(parse: (value: Record<string, unknown>) => Value | undefined): RequestSchema<Value> {
  return Object.freeze({
    parse(value) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false }
      const parsed = parse(value as Record<string, unknown>)
      return parsed === undefined ? { ok: false } : { ok: true, value: parsed }
    },
  })
}

const createSchema = objectSchema((value) => {
  if (
    typeof value.displayName !== 'string'
    || typeof value.startingCashMinorUnits !== 'string'
    || typeof value.mode !== 'string'
    || typeof value.strategyVersionId !== 'string'
  ) return undefined
  return Object.freeze({
    displayName: value.displayName,
    startingCashMinorUnits: value.startingCashMinorUnits,
    mode: value.mode,
    strategyVersionId: value.strategyVersionId,
  })
})

const archiveSchema = objectSchema((value) =>
  value.confirmation === 'ARCHIVE' ? Object.freeze({ confirmation: 'ARCHIVE' }) : undefined)

const importHoldingSchema = objectSchema((value) => {
  if (
    typeof value.instrumentId !== 'string'
    || typeof value.quantity !== 'string'
    || typeof value.unitCostMinorUnits !== 'string'
    || typeof value.acquiredOn !== 'string'
  ) return undefined
  return Object.freeze({
    instrumentId: value.instrumentId,
    quantity: value.quantity,
    unitCostMinorUnits: value.unitCostMinorUnits,
    acquiredOn: value.acquiredOn,
  })
})

const assignStrategySchema = objectSchema((value) =>
  typeof value.strategyVersionId === 'string'
    ? Object.freeze({ strategyVersionId: value.strategyVersionId })
    : undefined)

const generateRebalanceSchema = objectSchema((value) =>
  value.confirmation === 'GENERATE_RESEARCH_PREVIEW'
    ? Object.freeze({ confirmation: 'GENERATE_RESEARCH_PREVIEW' })
    : undefined)

const approveRebalanceSchema = objectSchema((value) =>
  value.confirmation === 'APPROVE_PAPER_PLAN' && typeof value.planId === 'string'
    ? Object.freeze({ confirmation: 'APPROVE_PAPER_PLAN', planId: value.planId })
    : undefined)

const executeRebalanceSchema = objectSchema((value) =>
  value.confirmation === 'EXECUTE_PAPER_PLAN' && typeof value.planId === 'string'
    ? Object.freeze({ confirmation: 'EXECUTE_PAPER_PLAN', planId: value.planId })
    : undefined)

const sharekhanReconciliationSchema = objectSchema((value) => {
  if (
    value.confirmation !== 'RECONCILE_SHAREKHAN_PAPER'
    || typeof value.brokerAsOf !== 'number'
    || typeof value.portfolioStateVersion !== 'number'
    || typeof value.availableCashMinorUnits !== 'string'
    || typeof value.fallbackAcquiredOn !== 'string'
    || !Array.isArray(value.holdings)
  ) return undefined
  const holdings = value.holdings.map((item) => {
    if (typeof item !== 'object' || item === null) return undefined
    const row = item as Record<string, unknown>
    if (
      typeof row.instrumentId !== 'string'
      || typeof row.quantity !== 'string'
      || typeof row.unitCostMinorUnits !== 'string'
      || (row.acquiredOn !== undefined && typeof row.acquiredOn !== 'string')
    ) return undefined
    return Object.freeze({
      instrumentId: row.instrumentId,
      quantity: row.quantity,
      unitCostMinorUnits: row.unitCostMinorUnits,
      ...(typeof row.acquiredOn === 'string' ? { acquiredOn:row.acquiredOn } : {}),
    })
  })
  if (holdings.some((item) => item === undefined)) return undefined
  return Object.freeze({
    confirmation: 'RECONCILE_SHAREKHAN_PAPER' as const,
    brokerAsOf: value.brokerAsOf,
    portfolioStateVersion: value.portfolioStateVersion,
    availableCashMinorUnits: value.availableCashMinorUnits,
    fallbackAcquiredOn: value.fallbackAcquiredOn,
    holdings: Object.freeze(holdings as Exclude<(typeof holdings)[number], undefined>[]),
  })
})

const refreshPerformanceSchema = objectSchema((value) =>
  value.confirmation === 'RECORD_PERFORMANCE_OBSERVATION'
    ? Object.freeze({ confirmation: 'RECORD_PERFORMANCE_OBSERVATION' })
    : undefined)

const exitPaperHoldingSchema = objectSchema((value) =>
  value.confirmation === 'EXIT_PAPER_HOLDING'
  && typeof value.instrumentId === 'string'
  && typeof value.quantity === 'string'
  && typeof value.portfolioStateVersion === 'number'
    ? Object.freeze({
        instrumentId: value.instrumentId,
        quantity: value.quantity,
        portfolioStateVersion: value.portfolioStateVersion,
      })
    : undefined)

const operationConfirmationSchema = objectSchema((value) =>
  value.confirmation === 'RUN_OPERATION'
    ? Object.freeze({ confirmation: 'RUN_OPERATION' as const })
    : undefined)

const openIncidentSchema = objectSchema((value) =>
  (value.severity === 'SEV1' || value.severity === 'SEV2' || value.severity === 'SEV3')
  && typeof value.code === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/u.test(value.code)
  && typeof value.correlationId === 'string' && value.correlationId.length >= 3 && value.correlationId.length <= 128
    ? Object.freeze({ severity: value.severity, code: value.code, correlationId: value.correlationId })
    : undefined)

const closeIncidentSchema = objectSchema((value) =>
  Array.isArray(value.actionCodes)
  && value.actionCodes.length > 0 && value.actionCodes.length <= 16
  && value.actionCodes.every((item) => typeof item === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/u.test(item))
    ? Object.freeze({ actionCodes: Object.freeze(value.actionCodes as string[]) })
    : undefined)

const confirmMfaSchema = objectSchema((value) =>
  typeof value.code === 'string' && /^\d{6}$/u.test(value.code)
    ? Object.freeze({ code: value.code })
    : undefined)

const logoutSchema = objectSchema((value) =>
  value.confirm === true ? Object.freeze({ confirm: true }) : undefined)

const bootstrapSchema = objectSchema((value) => {
  if (
    typeof value.username !== 'string'
    || typeof value.password !== 'string'
    || value.username.length > 64
    || value.password.length > 256
    || (value.displayName !== undefined && typeof value.displayName !== 'string')
  ) return undefined
  return Object.freeze({
    username: value.username,
    password: value.password,
    ...(typeof value.displayName === 'string' ? { displayName: value.displayName } : {}),
  })
})

export type PortfolioHttpRuntime = Readonly<{
  handle(request: http.IncomingMessage, response: http.ServerResponse, pathname: string): Promise<boolean>
  close(): void
  configured: boolean
}>

export type PortfolioHttpRuntimeOptions = Readonly<{
  owner?: PortfolioDatabaseOwner
  now?: () => number
  allowedOrigins?: readonly string[]
  secureCookies?: boolean
  marketQuotes?: ResearchMarketQuoteProvider
  marketAnalysis?: ResearchMarketAnalysisProvider
  operationsBackupDirectory?: string
  bootstrap?: Readonly<{
    username?: string
    password?: string
    displayName?: string
    mfaSecret?: string
  }>
}>

export function createPortfolioHttpRuntime(options: PortfolioHttpRuntimeOptions = {}): PortfolioHttpRuntime {
  const now = options.now ?? Date.now
  const owned = options.owner === undefined
  const owner = options.owner ?? openConfiguredOwner(now)
  if (owner === undefined) {
    return Object.freeze({
      configured: false,
      async handle(_request, response, pathname) {
        if (!pathname.startsWith('/api/portfolio')) return false
        write(response, generic(503, 'PORTFOLIO_RUNTIME_UNAVAILABLE'))
        return true
      },
      close() {},
    })
  }

  const store = owner.apiStore
  const auth = new PortfolioAuthenticationService(store, now)
  const environmentBootstrap = {
    ...(process.env.PORTFOLIO_BOOTSTRAP_USERNAME === undefined ? {} : { username: process.env.PORTFOLIO_BOOTSTRAP_USERNAME }),
    ...(process.env.PORTFOLIO_BOOTSTRAP_PASSWORD === undefined ? {} : { password: process.env.PORTFOLIO_BOOTSTRAP_PASSWORD }),
    ...(process.env.PORTFOLIO_BOOTSTRAP_DISPLAY_NAME === undefined ? {} : { displayName: process.env.PORTFOLIO_BOOTSTRAP_DISPLAY_NAME }),
    ...(process.env.PORTFOLIO_BOOTSTRAP_MFA_SECRET === undefined ? {} : { mfaSecret: process.env.PORTFOLIO_BOOTSTRAP_MFA_SECRET }),
  }
  let configured = auth.bootstrap(options.bootstrap ?? environmentBootstrap)
    || store.countPrincipals() > 0
  const allowedOrigins = options.allowedOrigins ?? Object.freeze([
    'http://localhost:44100',
    'http://127.0.0.1:44100',
    ...(process.env.PORTFOLIO_ALLOWED_ORIGINS ?? '').split(',').map((item) => item.trim()).filter(Boolean),
  ])
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === 'production'
  const secureApi = new SecurePortfolioApi(
    new SqliteSessionAuthenticator(store, now),
    new SqlitePortfolioAuthorizer(store),
    { nowEpochMs: now },
    {
      allowedOrigins,
      maxPayloadBytes: MAX_BODY_BYTES,
      hsts: secureCookies,
      requireDurableIdempotency: true,
    },
    new SqliteAuthenticatedRateLimiter(store, now),
    new SqliteMutationIdempotency(store, now),
  )
  const service = new PortfolioApiApplicationService(
    owner,
    now,
    options.marketQuotes,
    options.marketAnalysis,
    options.operationsBackupDirectory ?? process.env.PORTFOLIO_BACKUP_DIRECTORY ?? path.resolve(process.cwd(), 'data', 'portfolio-backups'),
  )

  async function protectedRequest<Value>(
    nodeRequest: http.IncomingMessage,
    pathname: string,
    portfolioId: string,
    bodyText: string | undefined,
    resource: SecurePortfolioResource<Value>,
  ): Promise<PortfolioApiResponse> {
    const request: PortfolioApiRequest = {
      method: nodeRequest.method ?? 'GET',
      path: pathname,
      headers: toHeaderRecord(nodeRequest.headers),
      portfolioId,
      ...(bodyText === undefined ? {} : { bodyText }),
      requestFingerprint: sha256(`${nodeRequest.method ?? 'GET'}\n${pathname}\n${bodyText ?? ''}`),
    }
    return secureApi.handle(request, resource)
  }

  return Object.freeze({
    configured,
    async handle(nodeRequest, nodeResponse, pathname) {
      if (!pathname.startsWith('/api/portfolio')) return false
      const origin = typeof nodeRequest.headers.origin === 'string' ? nodeRequest.headers.origin : undefined
      if (nodeRequest.method === 'OPTIONS') {
        if (!isAllowedRequestOrigin(nodeRequest.headers, allowedOrigins, origin)) {
          write(nodeResponse, generic(403, 'ACCESS_DENIED'))
          return true
        }
        nodeResponse.writeHead(204, {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type, x-csrf-token, x-correlation-id, idempotency-key',
          'access-control-max-age': '600',
          vary: 'Origin',
        })
        nodeResponse.end()
        return true
      }

      try {
        if (pathname === '/api/portfolio/auth/status' && nodeRequest.method === 'GET') {
          write(nodeResponse, Object.freeze({
            status: 200,
            headers: SAFE_JSON_HEADERS,
            body: Object.freeze({ configured }),
          }))
          return true
        }
        if (pathname === '/api/portfolio/auth/login' && nodeRequest.method === 'POST') {
          if (!isAllowedRequestOrigin(nodeRequest.headers, allowedOrigins, origin)) {
            write(nodeResponse, generic(403, 'ACCESS_DENIED'))
            return true
          }
          const body = JSON.parse(await readBody(nodeRequest)) as Record<string, unknown>
          if (
            typeof body.username !== 'string'
            || body.username.length > 64
            || typeof body.password !== 'string'
            || body.password.length > 256
            || (body.mfaCode !== undefined && typeof body.mfaCode !== 'string')
          ) {
            write(nodeResponse, generic(400, 'INVALID_REQUEST'))
            return true
          }
          const clientSubject = sha256(`${nodeRequest.socket.remoteAddress ?? 'unknown'}:${nodeRequest.headers['user-agent'] ?? ''}`)
          const result = auth.login({
            username: body.username,
            password: body.password,
            ...(typeof body.mfaCode === 'string' ? { mfaCode: body.mfaCode } : {}),
            clientSubject,
          })
          if (!result.ok) {
            write(nodeResponse, Object.freeze({
              ...generic(result.status, result.status === 429 ? 'RATE_LIMITED' : 'AUTHENTICATION_REQUIRED'),
              headers: Object.freeze({
                ...SAFE_JSON_HEADERS,
                ...(result.retryAfterSeconds === undefined ? {} : { 'retry-after': String(result.retryAfterSeconds) }),
              }),
            }))
            return true
          }
          write(nodeResponse, Object.freeze({
            status: 200,
            headers: Object.freeze({
              ...SAFE_JSON_HEADERS,
              'set-cookie': [
                PortfolioAuthenticationService.cookie(result.sessionToken, secureCookies),
                PortfolioAuthenticationService.csrfCookie(result.csrfToken, secureCookies),
              ].join('|||'),
            }),
            body: Object.freeze({ authenticated: true, expiresAtEpochMs: result.expiresAtEpochMs }),
          }))
          return true
        }
        if (pathname === '/api/portfolio/auth/bootstrap' && nodeRequest.method === 'POST') {
          if (configured || store.countPrincipals() > 0) {
            write(nodeResponse, generic(409, 'ALREADY_CONFIGURED'))
            return true
          }
          if (!isAllowedRequestOrigin(nodeRequest.headers, allowedOrigins, origin)) {
            write(nodeResponse, generic(403, 'ACCESS_DENIED'))
            return true
          }
          const parsed = bootstrapSchema.parse(JSON.parse(await readBody(nodeRequest)))
          if (!parsed.ok) {
            write(nodeResponse, generic(400, 'INVALID_REQUEST'))
            return true
          }
          const bootstrapped = auth.bootstrap(parsed.value)
          if (!bootstrapped) {
            write(nodeResponse, generic(400, 'INVALID_BOOTSTRAP_CREDENTIALS'))
            return true
          }
          configured = true
          const clientSubject = sha256(`${nodeRequest.socket.remoteAddress ?? 'unknown'}:${nodeRequest.headers['user-agent'] ?? ''}`)
          const result = auth.login({
            username: parsed.value.username,
            password: parsed.value.password,
            clientSubject,
          })
          if (!result.ok) {
            write(nodeResponse, generic(401, 'AUTHENTICATION_REQUIRED'))
            return true
          }
          write(nodeResponse, Object.freeze({
            status: 201,
            headers: Object.freeze({
              ...SAFE_JSON_HEADERS,
              'set-cookie': [
                PortfolioAuthenticationService.cookie(result.sessionToken, secureCookies),
                PortfolioAuthenticationService.csrfCookie(result.csrfToken, secureCookies),
              ].join('|||'),
            }),
            body: Object.freeze({ configured: true, authenticated: true, expiresAtEpochMs: result.expiresAtEpochMs }),
          }))
          return true
        }

        const bodyText = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(nodeRequest.method ?? '')
          ? await readBody(nodeRequest)
          : undefined
        if (pathname === '/api/portfolio/auth/session' && nodeRequest.method === 'GET') {
          const result = await protectedRequest(nodeRequest, pathname, 'portfolio:collection', undefined, {
            access: 'READ',
            async handle(context) {
              const principal = store.findPrincipalById(String(context.session.actorId).replace(/^actor:/u, ''))
              return {
                status: 200,
                headers: SAFE_JSON_HEADERS,
                body: Object.freeze({
                  authenticated: true,
            displayName: principal?.displayName ?? 'Portfolio user',
            role: principal?.globalRole ?? 'INVESTOR',
            mfaConfigured: principal?.mfaSecret !== undefined,
            mfaVerified: context.session.mfaVerified,
            expiresAtEpochMs: context.session.expiresAtEpochMs,
                }),
              }
            },
          })
          write(nodeResponse, result)
          return true
        }
        if (pathname === '/api/portfolio/auth/logout' && nodeRequest.method === 'POST') {
          const apiRequest: PortfolioApiRequest = {
            method: 'POST', path: pathname, headers: toHeaderRecord(nodeRequest.headers),
            portfolioId: 'portfolio:collection', bodyText: bodyText ?? '',
            requestFingerprint: sha256(`POST\n${pathname}\n${bodyText ?? ''}`),
          }
          const result = await secureApi.handle(apiRequest, {
            access: 'MUTATE', mutation: true, schema: logoutSchema,
            async handle() {
              auth.logout(apiRequest)
              return {
                status: 200,
                headers: {
                  ...SAFE_JSON_HEADERS,
                  'set-cookie': [
                    PortfolioAuthenticationService.expiredCookie(secureCookies),
                    PortfolioAuthenticationService.expiredCsrfCookie(secureCookies),
                  ].join('|||'),
                },
                body: Object.freeze({ authenticated: false }),
              }
            },
          })
          write(nodeResponse, result)
          return true
        }
        if (pathname === '/api/portfolio/portfolios' && nodeRequest.method === 'GET') {
          const result = await protectedRequest(nodeRequest, pathname, 'portfolio:collection', undefined, {
            access: 'READ',
            async handle(context) {
              return { status: 200, headers: SAFE_JSON_HEADERS, body: service.list(context.session.actorId) }
            },
          })
          write(nodeResponse, result)
          return true
        }
        if (pathname === '/api/portfolio/portfolios' && nodeRequest.method === 'POST') {
          const result = await protectedRequest(nodeRequest, pathname, 'portfolio:collection', bodyText, {
            access: 'MUTATE', mutation: true, schema: createSchema,
            async handle(context) {
              const created = service.create(context.session.actorId, context.input)
              return created.ok
                ? { status: 201, headers: SAFE_JSON_HEADERS, body: created.value }
                : generic(created.error.code.includes('DUPLICATE') ? 409 : 400, 'INVALID_REQUEST')
            },
          })
          write(nodeResponse, result)
          return true
        }

        const importMatch = pathname.match(/^\/api\/portfolio\/portfolios\/([^/]+)\/holdings\/import$/u)
        if (importMatch !== null && nodeRequest.method === 'POST') {
          const portfolioId = decodeURIComponent(importMatch[1] ?? '')
          const result = await protectedRequest(nodeRequest, pathname, portfolioId, bodyText, {
            access: 'MUTATE', mutation: true, schema: importHoldingSchema,
            async handle(context) {
              const imported = service.importHolding(context.session.actorId, portfolioId, context.input)
              return imported.ok
                ? { status: 201, headers: SAFE_JSON_HEADERS, body: imported.value }
                : generic(imported.error.code.includes('DUPLICATE') ? 409 : 400, 'INVALID_REQUEST')
            },
          })
          write(nodeResponse, result)
          return true
        }

        const assignStrategyMatch = pathname.match(/^\/api\/portfolio\/portfolios\/([^/]+)\/strategy\/assign$/u)
        if (assignStrategyMatch !== null && nodeRequest.method === 'POST') {
          const portfolioId = decodeURIComponent(assignStrategyMatch[1] ?? '')
          const result = await protectedRequest(nodeRequest, pathname, portfolioId, bodyText, {
            access: 'MUTATE', mutation: true, schema: assignStrategySchema,
            async handle(context) {
              const assigned = service.assignStrategy(context.session.actorId, portfolioId, context.input)
              return assigned.ok
                ? { status: 200, headers: SAFE_JSON_HEADERS, body: assigned.value }
                : generic(400, 'INVALID_REQUEST')
            },
          })
          write(nodeResponse, result)
          return true
        }

        const generateRebalanceMatch = pathname.match(/^\/api\/portfolio\/portfolios\/([^/]+)\/rebalance\/generate$/u)
        if (generateRebalanceMatch !== null && nodeRequest.method === 'POST') {
          const portfolioId = decodeURIComponent(generateRebalanceMatch[1] ?? '')
          const result = await protectedRequest(nodeRequest, pathname, portfolioId, bodyText, {
            access: 'MUTATE', mutation: true, schema: generateRebalanceSchema,
            async handle(context) {
              const generated = await service.generateResearchRebalance(context.session.actorId, portfolioId)
              return generated.ok
                ? { status: 201, headers: SAFE_JSON_HEADERS, body: generated.value }
                : generic(400, 'PLANNING_BLOCKED')
            },
          })
          write(nodeResponse, result)
          return true
        }

        const approveRebalanceMatch = pathname.match(/^\/api\/portfolio\/portfolios\/([^/]+)\/rebalance\/approve$/u)
  if (approveRebalanceMatch !== null && nodeRequest.method === 'POST') {
          const portfolioId = decodeURIComponent(approveRebalanceMatch[1] ?? '')
          const result = await protectedRequest(nodeRequest, pathname, portfolioId, bodyText, {
            access: 'MUTATE', mutation: true, schema: approveRebalanceSchema,
            async handle(context) {
              const approved = service.approveResearchRebalance(context.session.actorId, portfolioId, context.input.planId)
              return approved.ok
                ? { status: 200, headers: SAFE_JSON_HEADERS, body: approved.value }
                : generic(409, 'PLAN_STALE_OR_NOT_APPROVABLE')
            },
          })
          write(nodeResponse, result)
    return true
  }

  const executeRebalanceMatch = pathname.match(/^\/api\/portfolio\/portfolios\/([^/]+)\/rebalance\/execute$/u)
  if (executeRebalanceMatch !== null && nodeRequest.method === 'POST') {
    const portfolioId = decodeURIComponent(executeRebalanceMatch[1] ?? '')
    const result = await protectedRequest(nodeRequest, pathname, portfolioId, bodyText, {
      access: 'MUTATE', mutation: true, schema: executeRebalanceSchema,
      async handle(context) {
        const executed = service.approveResearchRebalance(context.session.actorId, portfolioId, context.input.planId)
        return executed.ok
          ? { status: 200, headers: SAFE_JSON_HEADERS, body: executed.value }
          : generic(409, 'PLAN_STALE_OR_NOT_EXECUTABLE')
      },
    })
    write(nodeResponse, result)
    return true
  }

        const refreshPerformanceMatch = pathname.match(/^\/api\/portfolio\/portfolios\/([^/]+)\/performance\/refresh$/u)
        if (refreshPerformanceMatch !== null && nodeRequest.method === 'POST') {
          const portfolioId = decodeURIComponent(refreshPerformanceMatch[1] ?? '')
          const result = await protectedRequest(nodeRequest, pathname, portfolioId, bodyText, {
            access: 'MUTATE', mutation: true, schema: refreshPerformanceSchema,
            async handle(context) {
              const refreshed = await service.refreshPerformance(context.session.actorId, portfolioId)
              return refreshed.ok
                ? { status: 201, headers: SAFE_JSON_HEADERS, body: refreshed.value }
                : generic(400, 'PERFORMANCE_OBSERVATION_BLOCKED')
            },
          })
          write(nodeResponse, result)
          return true
        }

        const exitPaperHoldingMatch = pathname.match(/^\/api\/portfolio\/portfolios\/([^/]+)\/holdings\/exit$/u)
    if (exitPaperHoldingMatch !== null && nodeRequest.method === 'POST') {
          const portfolioId = decodeURIComponent(exitPaperHoldingMatch[1] ?? '')
          const result = await protectedRequest(nodeRequest, pathname, portfolioId, bodyText, {
            access: 'MUTATE', mutation: true, schema: exitPaperHoldingSchema,
            async handle(context) {
              const exited = await service.exitPaperHolding(context.session.actorId, portfolioId, context.input)
              return exited.ok
                ? { status: 200, headers: SAFE_JSON_HEADERS, body: exited.value }
                : generic(409, 'PAPER_EXIT_BLOCKED')
            },
          })
          write(nodeResponse, result)
      return true
    }

    const mfaSetupMatch = pathname.match(/^\/api\/portfolio\/portfolios\/([^/]+)\/operations\/mfa\/setup$/u)
    if (mfaSetupMatch !== null && nodeRequest.method === 'POST') {
      const portfolioId = decodeURIComponent(mfaSetupMatch[1] ?? '')
      const result = await protectedRequest(nodeRequest, pathname, portfolioId, bodyText, {
        access: 'MUTATE', mutation: true, schema: operationConfirmationSchema,
        async handle(context) {
          const enrollment = auth.beginMfaEnrollment(String(context.session.actorId))
          return enrollment === undefined
            ? generic(409, 'MFA_ENROLLMENT_BLOCKED')
            : { status: 201, headers: SAFE_JSON_HEADERS, body: enrollment }
        },
      })
      write(nodeResponse, result)
      return true
    }

    const mfaConfirmMatch = pathname.match(/^\/api\/portfolio\/portfolios\/([^/]+)\/operations\/mfa\/confirm$/u)
    if (mfaConfirmMatch !== null && nodeRequest.method === 'POST') {
      const portfolioId = decodeURIComponent(mfaConfirmMatch[1] ?? '')
      const result = await protectedRequest(nodeRequest, pathname, portfolioId, bodyText, {
        access: 'MUTATE', mutation: true, schema: confirmMfaSchema,
        async handle(context) {
          const confirmed = auth.confirmMfaEnrollment(String(context.session.actorId), context.input.code)
          return confirmed
            ? {
                status: 200,
                headers: Object.freeze({
                  ...SAFE_JSON_HEADERS,
                  'set-cookie': [
                    PortfolioAuthenticationService.expiredCookie(secureCookies),
                    PortfolioAuthenticationService.expiredCsrfCookie(secureCookies),
                  ].join('|||'),
                }),
                body: Object.freeze({ configured: true, reloginRequired: true }),
              }
            : generic(409, 'MFA_CONFIRMATION_FAILED')
        },
      })
      write(nodeResponse, result)
      return true
    }

    const operationsActionMatch = pathname.match(/^\/api\/portfolio\/portfolios\/([^/]+)\/operations\/(health|backup|restore-preflight|recovery-scan)$/u)
    if (operationsActionMatch !== null && nodeRequest.method === 'POST') {
      const portfolioId = decodeURIComponent(operationsActionMatch[1] ?? '')
      const action = operationsActionMatch[2]
      const result = await protectedRequest(nodeRequest, pathname, portfolioId, bodyText, {
        access: 'PRIVILEGED', mutation: true, schema: operationConfirmationSchema,
        async handle(context) {
          const operation = action === 'health'
            ? await service.runOperationsHealthCheck(context.session.actorId, portfolioId)
            : action === 'backup'
              ? await service.createOperationsBackup(context.session.actorId, portfolioId)
              : action === 'restore-preflight'
                ? await service.runOperationsRestorePreflight(context.session.actorId, portfolioId)
                : await service.runOperationsRecoveryScan(context.session.actorId, portfolioId)
          return operation.ok
            ? { status: action === 'backup' ? 201 : 200, headers: SAFE_JSON_HEADERS, body: operation.value }
            : generic(409, operation.code)
        },
      })
      write(nodeResponse, result)
      return true
    }

    const sharekhanReconciliationMatch = pathname.match(/^\/api\/portfolio\/portfolios\/([^/]+)\/operations\/sharekhan-reconciliation\/apply$/u)
    if (sharekhanReconciliationMatch !== null && nodeRequest.method === 'POST') {
      const portfolioId = decodeURIComponent(sharekhanReconciliationMatch[1] ?? '')
      const result = await protectedRequest(nodeRequest, pathname, portfolioId, bodyText, {
        access: 'PRIVILEGED', mutation: true, schema: sharekhanReconciliationSchema,
        async handle(context) {
          const applied = service.reconcileSharekhanPortfolio(context.session.actorId, portfolioId, context.input)
          return applied.ok
            ? { status: 200, headers: SAFE_JSON_HEADERS, body: applied.value }
            : generic(409, 'BROKER_RECONCILIATION_BLOCKED')
        },
      })
      write(nodeResponse, result)
      return true
    }

    const openIncidentMatch = pathname.match(/^\/api\/portfolio\/portfolios\/([^/]+)\/operations\/incidents$/u)
    if (openIncidentMatch !== null && nodeRequest.method === 'POST') {
      const portfolioId = decodeURIComponent(openIncidentMatch[1] ?? '')
      const result = await protectedRequest(nodeRequest, pathname, portfolioId, bodyText, {
        access: 'PRIVILEGED', mutation: true, schema: openIncidentSchema,
        async handle(context) {
          const incident = await service.openOperationsIncident(context.session.actorId, portfolioId, context.input)
          return incident.ok
            ? { status: 201, headers: SAFE_JSON_HEADERS, body: incident.value }
            : generic(409, incident.code)
        },
      })
      write(nodeResponse, result)
      return true
    }

    const closeIncidentMatch = pathname.match(/^\/api\/portfolio\/portfolios\/([^/]+)\/operations\/incidents\/([^/]+)\/close$/u)
    if (closeIncidentMatch !== null && nodeRequest.method === 'POST') {
      const portfolioId = decodeURIComponent(closeIncidentMatch[1] ?? '')
      const incidentId = decodeURIComponent(closeIncidentMatch[2] ?? '')
      const result = await protectedRequest(nodeRequest, pathname, portfolioId, bodyText, {
        access: 'PRIVILEGED', mutation: true, schema: closeIncidentSchema,
        async handle(context) {
          const incident = await service.closeOperationsIncident(
            context.session.actorId, portfolioId, incidentId, context.input.actionCodes,
          )
          return incident.ok
            ? { status: 200, headers: SAFE_JSON_HEADERS, body: incident.value }
            : generic(409, incident.code)
        },
      })
      write(nodeResponse, result)
      return true
    }

    const match = pathname.match(/^\/api\/portfolio\/portfolios\/([^/]+)(?:\/(overview|holdings|strategy|rebalance|performance|operations|archive))?$/u)
        if (match !== null) {
          const portfolioId = decodeURIComponent(match[1] ?? '')
          const view = match[2] ?? 'overview'
          if (view === 'archive' && nodeRequest.method === 'POST') {
            const result = await protectedRequest(nodeRequest, pathname, portfolioId, bodyText, {
              access: 'MUTATE', mutation: true, schema: archiveSchema,
              async handle(context) {
                const archived = service.archive(context.session.actorId, portfolioId, context.input.confirmation)
                return archived.ok
                  ? { status: 200, headers: SAFE_JSON_HEADERS, body: archived.value }
                  : generic(400, 'INVALID_REQUEST')
              },
            })
            write(nodeResponse, result)
            return true
          }
          if (nodeRequest.method === 'GET') {
            const result = await protectedRequest(nodeRequest, pathname, portfolioId, undefined, {
              access: view === 'operations' ? 'PRIVILEGED' : 'READ',
              async handle(context) {
                const data = view === 'operations'
                  ? await service.operationsDashboard(context.session.actorId, portfolioId)
                  : service.view(context.session.actorId, portfolioId)
                if (data === undefined) return generic(403, 'ACCESS_DENIED')
                const selected = view === 'operations'
                  ? data
                  : view === 'overview'
                  ? data
                  : (data as Record<string, unknown>)[view]
                return { status: 200, headers: SAFE_JSON_HEADERS, body: selected ?? data }
              },
            })
            write(nodeResponse, result)
            return true
          }
        }
        write(nodeResponse, generic(404, 'NOT_FOUND'))
        return true
      } catch {
        write(nodeResponse, generic(400, 'INVALID_REQUEST'))
        return true
      }
    },
    close() {
      if (owned) owner.close()
    },
  })
}

function openConfiguredOwner(nowEpochMs: () => number): PortfolioDatabaseOwner | undefined {
  const now = () => new Date(nowEpochMs()).toISOString() as Instant
  const databasePath = process.env.PORTFOLIO_DATABASE_PATH
    ?? path.resolve(process.cwd(), 'data', 'portfolio-management.db')
  const production = process.env.NODE_ENV === 'production'
  let configuration: PortfolioDatabaseConfiguration
  if (production) {
    const protection = process.env.PORTFOLIO_DB_PROTECTION
    if (protection !== 'BITLOCKER' && protection !== 'EFS') return undefined
    configuration = defaultPortfolioDatabaseConfiguration(
      databasePath,
      [path.resolve(process.cwd(), 'stock-watcher.db')],
      new ConfiguredEncryptionAttestation(protection, now),
      now,
    )
  } else {
    configuration = Object.freeze({
      databasePath,
      mode: 'TEMPORARY_TEST',
      protectedLegacyPaths: Object.freeze([path.resolve(process.cwd(), 'stock-watcher.db')]),
      busyTimeoutMs: 5_000,
      encryptionAttestation: new TemporaryTestEncryptionAttestation(now()),
      now,
      defaultStartingCashMinorUnits: 100_000_000n,
    })
  }
  const opened = openPortfolioDatabase(configuration)
  return opened.ok ? opened.value : undefined
}
