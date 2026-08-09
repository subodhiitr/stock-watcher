# U07 API and Runtime Integration - Implementation Plan

## Scope

This plan began as a small US-034 boundary slice and was extended to complete the approved local API/runtime integration needed by U08.

Included: injected session evidence, session expiry, deny-by-default portfolio authorization, MFA gating for privileged resources, bounded JSON/schema validation, restrictive origin and CSRF checks, mutation correlation and durable idempotency, generic errors, HTML security headers, database-backed security adapters, focused routes, runtime composition, proxy registration, lifecycle wiring, and focused tests.

U08 owns the dedicated UI. Full cross-unit capacity, restore, supply-chain, and acceptance evidence remains U09 work.

## Steps

- [x] Confirm US-034 ownership, U07 boundaries, and the user's basic-scope constraint.
- [x] Define small transport-neutral API, session, authorization, schema, and response contracts.
- [x] Implement authentication and exact portfolio authorization before resource handlers.
- [x] Implement expiry, privileged MFA, CORS, CSRF, payload, JSON, schema, correlation, and idempotency gates.
- [x] Implement stable generic errors and restrictive optional HTML headers.
- [x] Add explicit exports, focused npm scripts, behavior tests, and architecture tests.
- [x] Run U07 verification and U01/U05/U06 compatibility checks; document deferrals.
- [x] Add migration 003 for principals, memberships, sessions, idempotency, rate limits, and immutable security alerts.
- [x] Add SQLite security adapters, scrypt authentication, optional TOTP MFA, logout invalidation, and brute-force alerts.
- [x] Add portfolio collection/detail/create/archive/operations routes and the HTTP composition root.
- [x] Register `/api/portfolio` in the proxy and Remix forwarding path with graceful shutdown.
- [x] Verify the full U07 runtime, persistence compatibility, type contracts, and live HTTP integration.

## Safety Boundaries

- Invalid and unauthorized portfolio identifiers never select a fallback portfolio.
- Resource handlers are unreachable until session and object authorization pass.
- Durable session, idempotency, rate-limit, membership, and security-alert state is isolated in the portfolio database.
- Production startup fails closed unless database protection is attested as BitLocker or EFS.
- No broker credential, real-order submission, or legacy trading-state mutation is reachable through this integration.
