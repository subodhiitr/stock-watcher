import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'
import QRCode from 'qrcode'

import type {
  AuthenticatedRateLimiter,
  AuthenticatedSession,
  MutationIdempotencyPort,
  PortfolioApiRequest,
  PortfolioAuthorizer,
  SessionAuthenticator,
} from '../api/api-contracts.ts'
import { parseActorId, type ActorId } from '../domain/shared/identifiers.ts'
import type { PortfolioApiStore, PrincipalRecord } from '../ports/api/api-store.ts'

const SESSION_COOKIE = 'portfolio_session'
const CSRF_COOKIE = 'portfolio_csrf'
const SESSION_TTL_MS = 8 * 60 * 60 * 1_000
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000
const LOGIN_WINDOW_MS = 10 * 60 * 1_000
const LOGIN_BLOCK_MS = 15 * 60 * 1_000

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function principalIdFromActor(actorId: ActorId): string {
  return String(actorId).replace(/^actor:/u, '')
}

function cookieValue(request: PortfolioApiRequest, name: string): string | undefined {
  const header = Object.entries(request.headers).find(([key]) => key.toLowerCase() === 'cookie')?.[1]
  if (header === undefined) return undefined
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim())
    }
  }
  return undefined
}

function decodeBase32(value: string): Buffer | undefined {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const normalized = value.toUpperCase().replaceAll(' ', '').replace(/=+$/u, '')
  if (normalized.length < 16 || [...normalized].some((char) => !alphabet.includes(char))) return undefined
  let bits = ''
  for (const char of normalized) bits += alphabet.indexOf(char).toString(2).padStart(5, '0')
  const bytes: number[] = []
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2))
  }
  return Buffer.from(bytes)
}

function totp(secret: string, epochMs: number): string | undefined {
  const decoded = decodeBase32(secret)
  if (decoded === undefined) return undefined
  const counter = Math.floor(epochMs / 30_000)
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', decoded).update(message).digest()
  const offset = (digest.at(-1) ?? 0) & 0x0f
  const binary = ((digest[offset] ?? 0) & 0x7f) << 24
    | (digest[offset + 1] ?? 0) << 16
    | (digest[offset + 2] ?? 0) << 8
    | (digest[offset + 3] ?? 0)
  return String(binary % 1_000_000).padStart(6, '0')
}

export function verifyTotp(secret: string, code: string, nowEpochMs: number): boolean {
  if (!/^\d{6}$/u.test(code)) return false
  return [-30_000, 0, 30_000].some((offset) => {
    const expected = totp(secret, nowEpochMs + offset)
    return expected !== undefined
      && timingSafeEqual(Buffer.from(expected), Buffer.from(code))
  })
}

function qrDataUrl(value: string): string {
  const qr = QRCode.create(value, { errorCorrectionLevel: 'M' })
  const quietZone = 4
  const moduleCount = qr.modules.size
  let modules = ''
  for (let row = 0; row < moduleCount; row += 1) {
    for (let column = 0; column < moduleCount; column += 1) {
      if (qr.modules.get(row, column)) modules += `M${column + quietZone} ${row + quietZone}h1v1h-1z`
    }
  }
  const size = moduleCount + quietZone * 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${modules}" fill="#000"/></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
}

export function passwordDigest(password: string, saltHex: string): string {
  return scryptSync(password, Buffer.from(saltHex, 'hex'), 64).toString('hex')
}

function verifyPassword(password: string, principal: PrincipalRecord | undefined): boolean {
  const salt = principal?.passwordSalt ?? '0'.repeat(32)
  const expected = principal?.passwordHash ?? '0'.repeat(128)
  const actual = passwordDigest(password, salt)
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
    && principal !== undefined
    && !principal.disabled
}

export type LoginResult =
  | Readonly<{ ok: true; sessionToken: string; csrfToken: string; expiresAtEpochMs: number }>
  | Readonly<{ ok: false; status: 401 | 429; retryAfterSeconds?: number }>

export class PortfolioAuthenticationService {
  private readonly store: PortfolioApiStore
  private readonly now: () => number
  private readonly pendingMfa = new Map<string, Readonly<{ secret: string; expiresAtEpochMs: number }>>()

  constructor(store: PortfolioApiStore, now: () => number) {
    this.store = store
    this.now = now
  }

  bootstrap(input: Readonly<{
    username?: string
    password?: string
    displayName?: string
    mfaSecret?: string
  }>): boolean {
    if (this.store.countPrincipals() > 0) return true
    if (input.username === undefined || input.password === undefined || input.password.length < 12) {
      return false
    }
    const usernameKey = input.username.trim().toLowerCase()
    if (!/^[a-z0-9._-]{3,64}$/u.test(usernameKey)) return false
    const salt = randomBytes(16).toString('hex')
    const created = this.store.createPrincipal(Object.freeze({
      principalId: `principal:${randomUUID()}`,
      usernameKey,
      displayName: input.displayName?.trim().slice(0, 120) || input.username.trim().slice(0, 120),
      passwordSalt: salt,
      passwordHash: passwordDigest(input.password, salt),
      globalRole: 'ADMIN',
      ...(input.mfaSecret === undefined ? {} : { mfaSecret: input.mfaSecret }),
      disabled: false,
    }), this.now())
    const record = this.store.findPrincipalByUsername(usernameKey)
    if (created && record !== undefined) this.store.grantAllExistingPortfolios(record.principalId, this.now())
    return created
  }

  login(input: Readonly<{
    username: string
    password: string
    mfaCode?: string
    clientSubject: string
  }>): LoginResult {
    const now = this.now()
    const usernameKey = input.username.trim().toLowerCase().slice(0, 64)
    const bucketKey = sha256(`login:${usernameKey}:${input.clientSubject}`)
    const limit = this.store.allowRateLimit({
      bucketKey,
      nowEpochMs: now,
      windowMs: LOGIN_WINDOW_MS,
      limit: 5,
      blockMs: LOGIN_BLOCK_MS,
      consume: false,
    })
    if (!limit.allowed) {
      this.store.appendSecurityAlert({
        alertId: `security-alert:${randomUUID()}`,
        category: 'AUTH_BRUTE_FORCE',
        subjectHash: bucketKey,
        detailCode: 'LOGIN_THRESHOLD_EXCEEDED',
        createdAtEpochMs: now,
      })
      return Object.freeze({
        ok: false,
        status: 429,
        retryAfterSeconds: Math.max(1, Math.ceil(limit.retryAfterMs / 1_000)),
      })
    }
    const principal = this.store.findPrincipalByUsername(usernameKey)
    const passwordOk = verifyPassword(input.password, principal)
    const mfaOk = principal?.mfaSecret === undefined
      || (input.mfaCode !== undefined && verifyTotp(principal.mfaSecret, input.mfaCode, now))
    if (!passwordOk || !mfaOk || principal === undefined) {
      const failureLimit = this.store.allowRateLimit({
        bucketKey,
        nowEpochMs: now,
        windowMs: LOGIN_WINDOW_MS,
        limit: 5,
        blockMs: LOGIN_BLOCK_MS,
      })
      if (!failureLimit.allowed) {
        this.store.appendSecurityAlert({
          alertId: `security-alert:${randomUUID()}`,
          category: 'AUTH_BRUTE_FORCE',
          subjectHash: bucketKey,
          detailCode: 'LOGIN_THRESHOLD_EXCEEDED',
          createdAtEpochMs: now,
        })
        return Object.freeze({
          ok: false,
          status: 429,
          retryAfterSeconds: Math.max(1, Math.ceil(failureLimit.retryAfterMs / 1_000)),
        })
      }
      return Object.freeze({ ok: false, status: 401 })
    }
    const sessionToken = randomBytes(32).toString('base64url')
    const csrfToken = randomBytes(32).toString('base64url')
    const expiresAtEpochMs = now + SESSION_TTL_MS
    this.store.createSession({
      sessionHash: sha256(sessionToken),
      principalId: principal.principalId,
      csrfHash: sha256(csrfToken),
      createdAtEpochMs: now,
      expiresAtEpochMs,
      mfaVerified: principal.mfaSecret !== undefined,
    })
    return Object.freeze({ ok: true, sessionToken, csrfToken, expiresAtEpochMs })
  }

  logout(request: PortfolioApiRequest): void {
    const token = cookieValue(request, SESSION_COOKIE)
    if (token !== undefined) this.store.invalidateSession(sha256(token), this.now())
  }

  beginMfaEnrollment(actorId: string): Readonly<{
    secret: string
    otpauthUri: string
    qrDataUrl: string
    expiresAtEpochMs: number
  }> | undefined {
    const principalId = principalIdFromActor(actorId as ActorId)
    const principal = this.store.findPrincipalById(principalId)
    if (principal === undefined || principal.globalRole !== 'ADMIN' || principal.mfaSecret !== undefined || principal.disabled) return undefined
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    const entropy = randomBytes(20)
    let bits = ''
    for (const byte of entropy) bits += byte.toString(2).padStart(8, '0')
    let secret = ''
    for (let index = 0; index < bits.length; index += 5) {
      secret += alphabet[Number.parseInt(bits.slice(index, index + 5).padEnd(5, '0'), 2)] ?? ''
    }
    const expiresAtEpochMs = this.now() + 10 * 60 * 1_000
    this.pendingMfa.set(principalId, Object.freeze({ secret, expiresAtEpochMs }))
    const label = encodeURIComponent(`Stock Watcher:${principal.usernameKey}`)
    const otpauthUri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent('Stock Watcher')}&digits=6&period=30`
    return Object.freeze({ secret, otpauthUri, qrDataUrl: qrDataUrl(otpauthUri), expiresAtEpochMs })
  }

  confirmMfaEnrollment(actorId: string, code: string): boolean {
    const principalId = principalIdFromActor(actorId as ActorId)
    const pending = this.pendingMfa.get(principalId)
    if (pending === undefined || pending.expiresAtEpochMs < this.now() || !verifyTotp(pending.secret, code, this.now())) return false
    if (!this.store.setPrincipalMfaSecret(principalId, pending.secret)) return false
    this.pendingMfa.delete(principalId)
    this.store.invalidatePrincipalSessions(principalId, this.now())
    return true
  }

  static cookie(sessionToken: string, secure: boolean): string {
    return `${SESSION_COOKIE}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1_000}${secure ? '; Secure' : ''}`
  }

  static expiredCookie(secure: boolean): string {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`
  }

  static csrfCookie(csrfToken: string, secure: boolean): string {
    return `${CSRF_COOKIE}=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1_000}${secure ? '; Secure' : ''}`
  }

  static expiredCsrfCookie(secure: boolean): string {
    return `${CSRF_COOKIE}=; Path=/; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`
  }
}

export class SqliteSessionAuthenticator implements SessionAuthenticator {
  private readonly store: PortfolioApiStore
  private readonly now: () => number

  constructor(store: PortfolioApiStore, now: () => number) {
    this.store = store
    this.now = now
  }

  async authenticate(request: PortfolioApiRequest): Promise<AuthenticatedSession | null> {
    const token = cookieValue(request, SESSION_COOKIE)
    if (token === undefined) return null
    const now = this.now()
    const record = this.store.findSession(sha256(token), now)
    if (record === undefined) return null
    const actorId = parseActorId(record.actorId)
    if (!actorId.ok) return null
    this.store.touchSession(record.sessionHash, now)
    return Object.freeze({
      sessionId: record.sessionHash,
      actorId: actorId.value,
      expiresAtEpochMs: record.expiresAtEpochMs,
      csrfToken: `sha256:${record.csrfHash}`,
      mfaVerified: record.mfaVerified,
    })
  }
}

export class SqlitePortfolioAuthorizer implements PortfolioAuthorizer {
  private readonly store: PortfolioApiStore

  constructor(store: PortfolioApiStore) {
    this.store = store
  }

  async canAccess(input: Parameters<PortfolioAuthorizer['canAccess']>[0]): Promise<boolean> {
    return this.store.canAccessPortfolio(
      principalIdFromActor(input.actorId),
      input.portfolioId,
      input.access,
    )
  }
}

export class SqliteAuthenticatedRateLimiter implements AuthenticatedRateLimiter {
  private readonly store: PortfolioApiStore
  private readonly now: () => number

  constructor(store: PortfolioApiStore, now: () => number) {
    this.store = store
    this.now = now
  }

  async allow(session: AuthenticatedSession): Promise<Readonly<{ allowed: boolean; retryAfterSeconds?: number }>> {
    const result = this.store.allowRateLimit({
      bucketKey: sha256(`api:${session.actorId}`),
      nowEpochMs: this.now(),
      windowMs: 60_000,
      limit: 120,
      blockMs: 60_000,
    })
    return Object.freeze(result.allowed
      ? { allowed: true }
      : { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(result.retryAfterMs / 1_000)) })
  }
}

export class SqliteMutationIdempotency implements MutationIdempotencyPort {
  private readonly store: PortfolioApiStore
  private readonly now: () => number

  constructor(store: PortfolioApiStore, now: () => number) {
    this.store = store
    this.now = now
  }

  async begin(input: Parameters<MutationIdempotencyPort['begin']>[0]) {
    const now = this.now()
    return this.store.beginIdempotency({
      principalId: principalIdFromActor(input.session.actorId),
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestFingerprint,
      nowEpochMs: now,
      expiresAtEpochMs: now + IDEMPOTENCY_TTL_MS,
    })
  }

  async complete(input: Parameters<MutationIdempotencyPort['complete']>[0]): Promise<void> {
    this.store.completeIdempotency({
      principalId: principalIdFromActor(input.session.actorId),
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestFingerprint,
      response: input.response,
    })
  }

  async abandon(input: Parameters<MutationIdempotencyPort['abandon']>[0]): Promise<void> {
    this.store.abandonIdempotency(
      principalIdFromActor(input.session.actorId),
      input.idempotencyKey,
      input.requestFingerprint,
    )
  }
}

export function csrfMatches(stored: string, supplied: string): boolean {
  if (!stored.startsWith('sha256:')) return false
  return timingSafeEqual(
    Buffer.from(stored.slice(7), 'hex'),
    Buffer.from(sha256(supplied), 'hex'),
  )
}
