# U03 Strategy, Data, and Research – Deployment Architecture

## Runtime View

```text
Windows workstation
|
+-- Existing Node.js 24 application process
    |
    +-- Portfolio composition boundary (U07 later)
        |
        +-- U03 Strategy and Data evaluation boundary
            |
            +-- Application Services (in-process)
            |   +-- StrategyVersionService          (LC-U03-17)
            |   +-- EligibilityService              (LC-U03-12)
            |   +-- SignalScoringService            (LC-U03-13)
            |   +-- RegimeDeterminationService      (LC-U03-14)
            |   +-- CorporateActionProcessor        (LC-U03-15)
            |   +-- BacktestOrchestrationService    (LC-U03-16)
            |   +-- AiAdvisoryService               (LC-U03-18)
            |
            +-- Resilience Infrastructure (in-process, shared)
            |   +-- ProviderResilienceWrapper       (LC-U03-19)
            |   |   AbortController per-call deadline
            |   |   Exponential backoff retry (max 3)
            |   |   ProviderErrorEvent on exhaustion
            |   +-- ProviderCircuitBreakerRegistry  (LC-U03-20)
            |   |   One CircuitBreakerState per provider
            |   |   CLOSED / OPEN / HALF_OPEN state machine
            |   |   In-memory; resets on process restart
            |   +-- ResearchModeGate               (LC-U03-21)
            |   +-- CredentialRedactor             (LC-U03-22)
            |   +-- ProviderHealthRegistry         (in-process map)
            |
            +-- Provider Adapters (outbound HTTPS; one instance each)
            |   +-- MarketDataAdapter        --> PORTFOLIO_MARKET_DATA_BASE_URL
            |   +-- FundamentalsAdapter      --> PORTFOLIO_FUNDAMENTALS_BASE_URL
            |   +-- IndexMembershipAdapter   --> PORTFOLIO_INDEX_MEMBERSHIP_BASE_URL
            |   +-- CorporateActionAdapter   --> PORTFOLIO_CORP_ACTION_BASE_URL
            |   +-- ExchangeCalendarAdapter  --> PORTFOLIO_EXCHANGE_CALENDAR_BASE_URL
            |   +-- InstrumentRegistryAdap.  --> PORTFOLIO_INSTRUMENT_REGISTRY_BASE_URL
            |   +-- AiAdvisoryAdapter        --> OPENAI_BASE_URL (Headroom proxy)
            |
            +-- Research Data Adapters (in-process)
            |   +-- NseOfficialDataAdapter   reads  research-data/portfolio/nse/
            |   +-- YahooFinanceAdapter      fetch  query1.finance.yahoo.com (HTTPS)
            |
            +-- Persistence boundary (port interfaces → U02)
                +-- MarketDataSnapshotRepository  --> portfolio-management.db
                +-- StrategyVersionRepository     --> portfolio-management.db
                +-- BacktestRunRepository         --> portfolio-management.db
                +-- StrategyVersionUnitOfWork     --> portfolio-management.db

  Filesystem (same NTFS volume as U02 database)
  |
  +-- portfolio-management.db          (owned exclusively by U02)
  +-- research-data/portfolio/         (read-only by NseOfficialDataAdapter)
      +-- nse/                         (NSE official JSON files, operator-managed)
      +-- [excluded from git]

  Outbound network connections (HTTPS only)
  +-- Production providers    (TLS; system CA; per-call deadline; retry; circuit)
  +-- query1.finance.yahoo.com (TLS; research mode only; no API key; in-memory)
  +-- OPENAI_BASE_URL (127.0.0.1:8787 Headroom proxy → external AI API; TLS)

  Nothing opened inbound by U03.
  Legacy stock-watcher.db: protected; never opened or attached by U03.
```

## Text Alternative

The existing Node 24 process contains the portfolio composition boundary that will be formalized in U07. Within that boundary, U03 instantiates seven provider adapters, a research mode gate, a credential redactor, a shared provider resilience wrapper, a per-provider circuit breaker registry, an in-memory provider health registry, and all evaluation application services. Provider adapters make outbound HTTPS calls to external financial data endpoints using Node 24 built-in `fetch` wrapped by the resilience infrastructure. AI advisory calls route through the existing Headroom proxy at `127.0.0.1:8787`. Research data adapters either read NSE JSON files from a configurable local directory or fetch Yahoo Finance data in-memory; both produce `isProductionQuality = false` records. All durable writes go through U02 port interfaces; U03 never opens a database connection directly. The legacy `stock-watcher.db` is never opened or referenced.

---

## Startup Sequence

1. Read and validate all required environment variables (`PORTFOLIO_*`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`). Missing required variables abort startup with a descriptive configuration error before any adapter is constructed.
2. Construct `CredentialRedactor` with the current env-var key name allowlist.
3. Construct `ProviderCircuitBreakerRegistry` with configured thresholds (all circuits start CLOSED).
4. Construct `ProviderHealthRegistry` (all providers start UNKNOWN).
5. Construct `ProviderResilienceWrapper` with retry and deadline configuration.
6. Construct all seven provider adapter instances. Each adapter performs a lightweight structural self-check (URL is a valid HTTPS URL; credential is a non-empty string). Adapters with structural failures abort startup.
7. Construct `ResearchModeGate`.
8. Verify research data path (`PORTFOLIO_RESEARCH_DATA_PATH`) exists and is readable. Log a WARNING (not a failure) if absent; research mode evaluations will fail at runtime, not at startup.
9. Verify U02 persistence ports are available (the U02 database owner must be OPEN before U03 components are started).
10. Mark U03 evaluation boundary as READY.
11. Permit dependent application services (U04, U05, U07, U08) to start.

Startup failure at steps 1–6 prevents the portfolio composition boundary from reaching READY. The portfolio workload remains unavailable.

---

## Shutdown Sequence

1. Stop accepting new evaluation commands and strategy lifecycle commands.
2. Allow in-flight evaluation calls to complete or timeout (maximum: `PORTFOLIO_PROVIDER_TOTAL_FETCH_TIMEOUT_MS`, default 120 seconds).
3. Allow in-flight AI advisory calls to complete or timeout (maximum: per-call deadline, default 30 seconds).
4. Drain any pending domain event staging through the `StrategyVersionUnitOfWork` (U02 owns commit/rollback).
5. Flush any buffered structured log lines to stdout.
6. Release provider adapter instances (no explicit connection close required; HTTP connections are stateless).
7. Mark U03 evaluation boundary as STOPPED.

---

## Failure Boundaries

### Provider Adapter Failures

| Failure | Containment |
|---|---|
| HTTP 5xx from provider | Retry up to maxRetries; then ProviderErrorEvent + PROVIDER_UNAVAILABLE failure |
| Per-call deadline exceeded | AbortController fires; ProviderErrorEvent; treated as transient failure; retried |
| Total fetch deadline exceeded | TOTAL_FETCH_TIMEOUT; evaluation run fails closed; no partial result |
| Circuit OPEN | CIRCUIT_OPEN reason code; no network attempt; evaluation fails closed for critical providers |
| TLS certificate validation failure | No request sent; PROVIDER_TLS_ERROR; not retried; circuit records as failure |
| HTTP 401/403 from provider | Not retried; PROVIDER_AUTH_FAILURE; credential-redacted log entry; operator alert |
| HTTP 429 rate limit | Treated as transient; retry with extended backoff (2× normal); circuit does not open |
| Malformed response body | Schema validation failure; PROVIDER_INVALID_RESPONSE; not stored; not retried |
| Missing required env variable | Startup aborted before adapter construction |

### Research Data Adapter Failures

| Failure | Containment |
|---|---|
| NSE file missing for requested date | RESEARCH_DATA_UNAVAILABLE; evaluation proceeds with RESEARCH_MODE_ONLY label and missing-data flag |
| NSE file malformed | Schema validation failure; RESEARCH_DATA_INVALID; evaluation fails for that data type |
| Yahoo HTTPS call fails | RESEARCH_DATA_UNAVAILABLE; in-memory result discarded; DEGRADED_ADVISORY_CONTEXT if advisory path |
| Research data path missing at startup | WARNING logged; no startup failure; research mode evaluations fail at runtime |

### Evaluation Pipeline Failures

| Failure | Containment |
|---|---|
| DataVersionSnapshot incomplete (< 98% coverage) | INCOMPLETE_DATA_SNAPSHOT; evaluation fails closed; no partial snapshot stored |
| Non-production snapshot used for production eval | ResearchModeGate returns NON_PRODUCTION_DATA_FOR_PRODUCTION_EVAL; rejected before evaluation |
| NaN or Infinity in signal computation | COMPUTATION_ERROR on affected instrument only; other instruments unaffected; PAT-U03-003 |
| AI advisory port failure | DEGRADED_ADVISORY_CONTEXT flag on SignalSnapshot; critical evaluation path unaffected |
| Prohibited AI operation attempt | PROHIBITED_AI_OPERATION; logged to security audit trail; call blocked before adapter |
| Look-ahead violation detected in backtest | BacktestRun → FAILED; partial result discarded; FAILED status is final |
| Survivorship bias violation detected | BacktestRun → FAILED; partial result discarded |
| Strategy activation with incomplete evidence | DomainFailure(MISSING_REQUIRED_EVIDENCE); aggregate state unchanged; no event emitted |
| Circuit breaker state corruption (invariant) | DomainInvariantError propagates uncaught; process-level error boundary handles |

### Process-Level Failures

| Failure | Containment |
|---|---|
| Node process crash during evaluation | In-flight evaluation discarded; next run recomputes from U02 persisted data |
| Node process crash during activation commit | U02 transaction rolls back; strategy version remains in ACTIVATION_PENDING; retried by operator |
| OS out-of-memory during backtest | Process OOM; backtest run left in RUNNING state in U02 (U06 health check will detect stale run) |

---

## Explicitly Absent

- Cloud account, VPC, subnet, firewall rule, managed API gateway, or DNS zone.
- AWS, Azure, GCP, or any managed cloud service.
- Container, Dockerfile, Kubernetes deployment, Helm chart, or pod spec.
- Virtual machine or EC2/Compute instance.
- Managed database or data warehouse (BigQuery, RDS, Cosmos DB, Firestore).
- Caching layer (Redis, Memcached, Elasticache, CDN).
- Message broker or queue (SQS, Pub/Sub, RabbitMQ, Kafka, EventBridge).
- Search service (Elasticsearch, OpenSearch, Solr).
- Background worker or job scheduler service (Celery, BullMQ, Lambda, Cloud Run).
- Load balancer, reverse proxy, or ingress controller.
- External secret management service (AWS Secrets Manager, HashiCorp Vault, Azure Key Vault).
- Sidecar, service mesh, or network policy proxy (except the existing Headroom proxy at 127.0.0.1:8787 which is pre-existing and not introduced by U03).
- Direct SQL connection from U03 to any database.
- Shared transaction with legacy trading data (`stock-watcher.db`).
- Inbound TCP or HTTP listener owned or opened by U03.
