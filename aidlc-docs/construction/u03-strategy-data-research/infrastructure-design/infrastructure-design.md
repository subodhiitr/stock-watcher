# U03 Strategy, Data, and Research – Infrastructure Design

## Topology

U03 runs inside the existing local Node.js 24 application on Windows. It opens no network listener. All external calls are outbound HTTPS only. No cloud resource, container, external database service, cache, queue, worker thread, or sidecar is introduced.

U03 shares the same process as U01 and U02. Its provider adapters and resilience infrastructure components are instantiated once at application startup and remain in memory for the process lifetime.

---

## Deployment Environments

| Environment | Provider adapters | Research data | Circuit breaker state | Persistence |
|---|---|---|---|---|
| Local development | Real adapters using env-var credentials; or stub adapters injected at composition | Local `research-data/portfolio/` directory | In-memory; resets on restart | U02 `portfolio-management.db` (dev path) |
| Automated test | Injected mock/stub adapters; no real HTTP calls | In-memory fixtures via test generators | Fresh per test suite | U02 temporary test database |
| Local production | Real adapters using env-var production credentials; mandatory TLS | Local `research-data/portfolio/` or configured path | In-memory; resets on restart | U02 `portfolio-management.db` (production path) |

---

## Compute Mapping

- **Process**: Existing Node.js 24 process (same as U01/U02).
- **Threading**: Single-threaded synchronous evaluation. No worker threads.
- **In-process components instantiated once**: ProviderResilienceWrapper, ProviderCircuitBreakerRegistry, ProviderHealthRegistry, ResearchModeGate, and all seven provider adapter instances.
- **No child process** is spawned for backtest or batch evaluation. Evaluation is synchronous within the application request boundary.

---

## Network Mapping

### Outbound Provider Calls

U03 makes outbound HTTPS calls to up to seven external provider endpoints. All calls are request/response. No websocket, server-sent event, or streaming API is used by U03.

| Provider Port | Classification | Network direction | TLS |
|---|---|---|---|
| MarketDataPort | Critical | Outbound HTTPS | Mandatory; system CA store |
| FundamentalsPort | Critical | Outbound HTTPS | Mandatory; system CA store |
| IndexMembershipPort | Critical | Outbound HTTPS | Mandatory; system CA store |
| CorporateActionPort | Critical | Outbound HTTPS | Mandatory; system CA store |
| ExchangeCalendarPort | Critical | Outbound HTTPS | Mandatory; system CA store |
| InstrumentRegistryPort | Critical | Outbound HTTPS | Mandatory; system CA store |
| AiAdvisoryPort | Non-critical | Outbound HTTPS | Mandatory; system CA store |

### TLS Policy

- `rejectUnauthorized` is always `true`. No override is permitted.
- System CA trust store (Windows certificate store, accessible via Node's built-in TLS stack).
- No certificate pinning.
- Self-signed provider certificates are never accepted in production.
- TLS version: Node 24 default minimum (TLS 1.2 or higher).

### HTTP Client

Node 24 global `fetch` is used for all provider calls. No third-party HTTP library is added. The `AbortController` API (built-in) provides per-call deadline cancellation tied to the `ProviderResilienceWrapper` timeout mechanism.

### Inbound Network

U03 opens no inbound TCP or HTTP listener. U03 APIs are consumed in-process only.

---

## Provider Adapter Infrastructure

### Adapter Responsibilities

Each provider adapter:

1. Reads base URL and credential(s) from environment variables at construction time.
2. Builds outbound HTTPS requests using `fetch` with an `AbortController`-backed signal for the per-call deadline.
3. Validates the raw HTTP response status code before parsing the body.
4. Parses the response body against a declared schema (no field access before validation).
5. Converts validated response fields into U03 domain value objects with full provenance.
6. Passes calls through `ProviderResilienceWrapper` for retry, backoff, and circuit breaker gate.
7. Redacts credentials and internal details before any error context reaches domain failure payloads or logs.

### Environment Variable Naming

| Variable | Purpose |
|---|---|
| `PORTFOLIO_MARKET_DATA_BASE_URL` | MarketDataPort HTTP base URL |
| `PORTFOLIO_MARKET_DATA_API_KEY` | MarketDataPort credential |
| `PORTFOLIO_FUNDAMENTALS_BASE_URL` | FundamentalsPort HTTP base URL |
| `PORTFOLIO_FUNDAMENTALS_API_KEY` | FundamentalsPort credential |
| `PORTFOLIO_INDEX_MEMBERSHIP_BASE_URL` | IndexMembershipPort HTTP base URL |
| `PORTFOLIO_INDEX_MEMBERSHIP_API_KEY` | IndexMembershipPort credential |
| `PORTFOLIO_CORP_ACTION_BASE_URL` | CorporateActionPort HTTP base URL |
| `PORTFOLIO_CORP_ACTION_API_KEY` | CorporateActionPort credential |
| `PORTFOLIO_EXCHANGE_CALENDAR_BASE_URL` | ExchangeCalendarPort HTTP base URL |
| `PORTFOLIO_EXCHANGE_CALENDAR_API_KEY` | ExchangeCalendarPort credential (if applicable) |
| `PORTFOLIO_INSTRUMENT_REGISTRY_BASE_URL` | InstrumentRegistryPort HTTP base URL |
| `PORTFOLIO_INSTRUMENT_REGISTRY_API_KEY` | InstrumentRegistryPort credential |
| `OPENAI_API_KEY` | AiAdvisoryPort credential (existing variable) |
| `OPENAI_BASE_URL` | AiAdvisoryPort endpoint (existing variable; may route through Headroom proxy) |

All variables are documented in `.env.example` with placeholder values. None are committed to source control. None appear in log output, error payloads, database records, or TypeScript types outside adapter internals.

### Credential Loading Policy

- Credentials are read once at adapter construction time (`process.env.*`).
- They are stored as private fields inside the adapter class, never exposed on the class interface.
- The adapter never logs credentials, even partially.
- Missing or empty required credentials cause the adapter to throw a startup error (see Startup Sequence).
- Optional credentials (e.g. exchange calendar may not require auth) may be `undefined`; the adapter is coded accordingly.

---

## Provider Resilience Infrastructure

### ProviderResilienceWrapper

An in-process wrapper (LC-U03-19) applied to every outbound provider call:

- **Per-call deadline**: `AbortController` signal with configurable timeout (default 30 000 ms). Deadline fires → `PROVIDER_DEADLINE_EXCEEDED`.
- **Retry**: up to `maxRetries` (default 3) attempts. Exponential backoff: `baseDelayMs × 2^attempt` with uniform random jitter in [0, baseDelayMs). Each retry creates a fresh `AbortController`.
- **Retry triggers**: HTTP 5xx, network error, DNS error, deadline exceeded. HTTP 4xx except 429 are not retried.
- **Backoff configuration**: `PORTFOLIO_PROVIDER_RETRY_BASE_MS` (default 1 000 ms), `PORTFOLIO_PROVIDER_MAX_RETRIES` (default 3).
- **Total fetch deadline**: a configurable outer deadline covering all providers for one evaluation pass (default 120 000 ms, `PORTFOLIO_PROVIDER_TOTAL_FETCH_TIMEOUT_MS`). Exhausted total deadline returns `TOTAL_FETCH_TIMEOUT`.

### Per-Provider Circuit Breaker Registry

An in-process state machine (LC-U03-20) with one circuit per provider:

- **State machine**: CLOSED → OPEN (after `failureThreshold` consecutive failures, default 5) → HALF_OPEN (after `cooldownMs`, default 60 000 ms) → CLOSED (probe success) or OPEN (probe failure).
- **OPEN state**: calls return `CIRCUIT_OPEN` reason code immediately. No network attempt. Does not count as a retry.
- **HALF_OPEN state**: exactly one probe is permitted. All other concurrent callers receive `CIRCUIT_OPEN`.
- **Configuration variables**: `PORTFOLIO_CB_FAILURE_THRESHOLD` (default 5), `PORTFOLIO_CB_COOLDOWN_MS` (default 60 000).
- **State is in-memory only**. Resets to CLOSED on process restart.
- **Isolation**: circuit state for each provider is fully independent.

### Provider Health Registry

An in-process map (updated by LC-U03-19/20) recording the last-known health status per provider:

| Field | Description |
|---|---|
| providerIdentity | Logical provider name |
| status | HEALTHY, DEGRADED, CIRCUIT_OPEN, UNKNOWN |
| lastCheckedAt | Timestamp of last call attempt |
| consecutiveFailures | Current count |
| circuitState | CLOSED, OPEN, HALF_OPEN |
| lastErrorCode | Most recent typed error code |

U06 queries this registry through an injected port interface. No evaluation run is triggered by health queries.

---

## Storage Mapping

### Production Data (via U02 ports)

U03 never writes directly to any database. All production data is persisted through U02 port interfaces declared in LC-U03-24:

| Port | Stores | Physical owner |
|---|---|---|
| `MarketDataSnapshotRepository` | `DataVersionSnapshot` | U02 `portfolio-management.db` |
| `StrategyVersionRepository` | `StrategyVersion` aggregate | U02 `portfolio-management.db` |
| `BacktestRunRepository` | `BacktestRun` aggregate and result | U02 `portfolio-management.db` |
| `StrategyVersionUnitOfWork` | Atomic dual ACTIVE/SUPERSEDED transition | U02 `portfolio-management.db` |

### Research Data (local files)

Research data lives in a configurable local directory, physically separate from the U02 database:

| Variable | Default | Purpose |
|---|---|---|
| `PORTFOLIO_RESEARCH_DATA_PATH` | `research-data/portfolio/` | Root directory for research data files |

**NSE official data** (historical price and fundamentals):
- Stored as newline-delimited JSON files (one file per data type per date range), downloaded out-of-band by the operator.
- The `NseOfficialDataAdapter` (port implementation for research mode) reads files from `$PORTFOLIO_RESEARCH_DATA_PATH/nse/`.
- Files are read-only; the adapter never writes to them.
- File format and naming conventions are documented in `research-data/portfolio/README.md` (created during Code Generation).

**Yahoo Finance data**:
- Fetched at request time via outbound HTTPS to `query1.finance.yahoo.com` (no API key required for public endpoints).
- Results are held in memory for the evaluation session only. No Yahoo data is written to disk or to the U02 database.
- The `YahooFinanceAdapter` applies the same TLS policy as production adapters.
- Yahoo data always carries `isProductionQuality = false`.

**Research data protection**:
- The `research-data/portfolio/` directory and its contents are excluded from source control (`.gitignore`).
- Research data files are never attached to backup operations or migrated via U02.

### Excluded Storage

- U03 does not own or access `stock-watcher.db` or any legacy trading database.
- U03 does not maintain a cache, Redis instance, or in-memory database between evaluation runs.
- Evaluation results that are not persisted through U02 ports are discarded at the end of the evaluation call.

---

## Messaging Mapping

- No external message broker, queue, pub/sub service, or outbox service is introduced.
- Domain events (strategy lifecycle events, AI advisory audit events) are staged to U02's `domain_events` table through the `StrategyVersionUnitOfWork` and commit atomically with aggregate state.
- U06 owns event publication and downstream delivery.

---

## Observability Mapping

U03 emits structured JSON log lines to `stdout`. Each log line contains:

- `timestamp`: ISO-8601 UTC
- `level`: `info`, `warn`, `error`
- `correlationId`: evaluation run or command correlation ID
- `component`: logical component name (e.g. `ProviderResilienceWrapper`, `StrategyVersionService`)
- `event`: typed string enum value (e.g. `PROVIDER_RETRY_ATTEMPT`, `CIRCUIT_STATE_CHANGE`, `PROHIBITED_AI_OPERATION`)
- `providerIdentity`: logical provider name (never credentials, never base URL with keys)
- `details`: bounded structured object (credential-redacted per LC-U03-22)

U03 does not write to files, sockets, or databases for observability. U06 will consume `stdout` and route to its log aggregation layer.

---

## Permissions and Secrets

- U03 accepts no database password or encryption key.
- Provider credentials live only in environment variables and private adapter fields.
- Paths to the research data directory are redacted from domain failures and audit events.
- Database contents, raw HTTP response bodies, and raw provider error messages never appear in logs.
- Test fixtures use generated fake credentials. No real API key appears in any test or fixture file.

---

## Infrastructure Extension Compliance

### Security Baseline

- **SECURITY-01**: Provider API keys reside in environment variables protected by OS user account controls.
- **SECURITY-03**: All provider errors and AI advisory interactions are logged as structured, credential-redacted JSON to stdout.
- **SECURITY-05**: Provider payloads are schema-validated before any field access (PAT-U03-002, PAT-U03-010).
- **SECURITY-06 / SECURITY-07 (IAM/network ACL)**: No cloud IAM, VPC, subnet, or managed network firewall. Outbound TLS to provider endpoints only; no inbound port.
- **SECURITY-09**: Credentials are environment-variable-based; never in source, database, or log.
- **SECURITY-13**: Strategy lifecycle and AI advisory interactions produce immutable audit events committed atomically to U02 event ledger.
- **SECURITY-15**: Config JSON and all provider payloads are schema-validated before field access; prototype-polluting keys are rejected.

### Resiliency Baseline

- **RESILIENCY-01**: Evaluation critical path classified as HIGH workload criticality. Advisory path classified as NORMAL.
- **RESILIENCY-02**: Availability and RTO inherit from the containing portfolio process; no independent U03 SLA. Multi-zone and auto-scaling are N/A.
- **RESILIENCY-05**: Per-call retry with exponential backoff and deadline (PAT-U03-005).
- **RESILIENCY-06**: Per-provider independent circuit breaker (PAT-U03-006).
- **RESILIENCY-10**: Non-critical advisory path degrades to DEGRADED_ADVISORY_CONTEXT without blocking the critical path (PAT-U03-013).
- **RESILIENCY-14**: Assigned to U06 (as per aidlc-state.md); N/A for U03.

No blocking infrastructure finding remains.
