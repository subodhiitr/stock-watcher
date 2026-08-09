# U07 API and Runtime Integration Summary

## Outcome

U07 is complete for the approved local modular-monolith runtime. The original transport-neutral US-034 protection layer now has database-backed security adapters, focused portfolio routes, guarded first-run administrator bootstrap, a composition root, and proxy/Remix lifecycle integration.

## Implemented

- `api/api-contracts.ts`: request, session, authorization, clock, schema, handler, response, and policy contracts.
- `api/secure-handler.ts`: session expiry, exact portfolio authorization, privileged MFA gate, restrictive origin and CSRF checks, payload and JSON bounds, injected schema validation, mutation correlation/idempotency evidence, and generic failure mapping.
- `api/security-headers.ts`: CSP, HSTS policy switch, `nosniff`, frame denial, and no-referrer headers for HTML resources.
- `infrastructure/persistence/migrations/003-api-security-schema.ts`: principals, memberships, expiring sessions, durable idempotency, rate limits, and immutable security alerts.
- `adapters/api/sqlite-api-store.ts`: parameterized persistence for authentication, authorization, idempotency, throttling, alerts, and portfolio workspace reads.
- `composition/security-adapters.ts`: scrypt password verification, optional TOTP MFA, secure session cookies, CSRF, authorization, logout invalidation, and brute-force protection.
- `composition/http-runtime.ts`: bounded HTTP translation for zero-principal administrator bootstrap, authentication, portfolio collection, creation, isolated views, operations, and archive.
- `ticker_proxy.js`, Remix proxy configuration, and server lifecycle: focused `/api/portfolio` registration and graceful close.
- `api.ts` and the portfolio root: explicit public exports.

## Story Coverage

- US-034: guarded first-run administrator setup, secure login/session/logout, expiry, object authorization before resource access, bounded mutation validation, correlation and durable idempotency, CSRF/CORS, rate limits, privileged MFA, brute-force alerts, stable redacted errors, and HTML headers are covered.
- Runtime integration preserves `/trade-execution` as canonical and `/paper-trades` as its compatibility alias.

## Verification

- `test:portfolio:u07:full`: 11/11 passing.
- `typecheck:portfolio`: passing.
- `typecheck:ui`: passing.
- `test:portfolio:contracts`: passing.
- `test:portfolio:persistence`: 23/23 passing.
- Live HTTP smoke: dedicated `/portfolio` returns 200 with protected sign-in and restrictive CSP/frame headers.
- Full repository suite: 888/888 passing.

## Remaining Cross-Unit Work

The dedicated React workspace is owned by U08. Integrated capacity, restore-drill, supply-chain, and release evidence remains owned by U09.

## Safety

Unexpected failures return a fixed error shape without stack, path, database, token, account, or adapter details. Production portfolio persistence fails closed without an explicit BitLocker or EFS protection attestation. The API does not expose broker credentials or add a real-order path.
