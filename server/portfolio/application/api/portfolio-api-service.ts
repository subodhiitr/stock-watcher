import { createHash, randomUUID } from 'node:crypto'

import { failure, success, type AnyDomainFailure, type DomainResult } from '../../domain/errors/result.ts'
import { persistenceFailure } from '../../infrastructure/persistence/failures.ts'
import { Portfolio } from '../../domain/portfolio/portfolio.ts'
import { createStrategyEligibilityEvidence, parseIntegrityHash } from '../../domain/portfolio/evidence.ts'
import { createSingleStrategyAllocation } from '../../domain/portfolio/strategy-allocation.ts'
import { createHolding } from '../../domain/portfolio/holding.ts'
import { createHoldingLot } from '../../domain/portfolio/holding-lot.ts'
import {
  parseActorId,
  parseCausationId,
  parseCommandId,
  parseCorrelationId,
  parseEventId,
  parseEvidenceId,
  parseHoldingId,
  parseHoldingLotId,
  parseInstrumentId,
  parsePortfolioId,
  parseStrategyAssignmentId,
  parseStrategyVersionId,
} from '../../domain/shared/identifiers.ts'
import { createMoney } from '../../domain/shared/money.ts'
import { createQuantity } from '../../domain/shared/quantity.ts'
import { createPortfolioStateVersion, NO_PORTFOLIO_STATE_VERSION } from '../../domain/shared/state-version.ts'
import { parseInstant, parseLocalDate, type Instant } from '../../domain/shared/time.ts'
import { createWeight } from '../../domain/shared/weight.ts'
import type { PortfolioApiStore } from '../../ports/api/api-store.ts'
import type { PortfolioDatabaseOwner } from '../../infrastructure/persistence/database-owner.ts'
import { canonicalJson } from '../../adapters/persistence/codecs.ts'
import { approvedStrategyProfile } from './strategy-profiles.ts'
import {
  selectResearchCandidates,
  type ResearchMarketAnalysisProvider,
} from './research-candidate-selection.ts'
import { SIX_FACTOR_RESEARCH_MODEL } from './research-model.ts'
import { assessPositionExitRisk, type PositionExitRiskAssessment } from './position-exit-risk.ts'
import { createPerformanceObservation } from './performance-observation.ts'
import {
  calculateStrategicRebalanceSnapshot,
  withStrategicCashImpact,
  type StrategicRebalanceSnapshot,
} from '../rebalancing/relative-trend-signal.ts'
import { applyStrategicTradeTiming } from '../rebalancing/strategic-trade-timing.ts'
import { PortfolioOperationsApiService } from '../operations/operations-api-service.ts'
import type { IncidentSeverity } from '../../domain/operations/contracts.ts'

export type ResearchMarketQuote = Readonly<{
  symbol: string
  price: number
  prevClose?: number
}>

export type ResearchMarketQuoteProvider = (
  symbols: readonly string[],
) => Promise<Readonly<{ quotes: Readonly<Record<string, ResearchMarketQuote>> }>>

const SAFE_CREATION_MODES = new Set(['OBSERVE', 'PAPER', 'RECOMMENDATION'])
const FAR_FUTURE = must(parseInstant('9999-12-31T23:59:59.999Z'))

function must<T>(result: DomainResult<T, AnyDomainFailure>): T {
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

function principalId(actorId: string): string {
  return actorId.replace(/^actor:/u, '')
}

function marketSymbol(instrumentId: string): string | undefined {
  const value = instrumentId.trim().toUpperCase()
  if (value === '' || value.startsWith('BSE:')) return undefined
  return value.replace(/^NSE:/u, '').replace(/\.NS$/u, '') || undefined
}

function benchmarkMarketSymbol(benchmark: string): string {
  const normalized = benchmark.trim().toUpperCase()
  if (normalized === 'NIFTY50' || normalized === 'NIFTY50TR') return 'NIFTYBEES.NS'
  if (normalized === 'NIFTY500' || normalized === 'NIFTY500TR') return 'MONIFTY500.NS'
  return normalized
}

function priceMinorUnits(price: number): bigint | undefined {
  return Number.isFinite(price) && price > 0 ? BigInt(Math.round(price * 100)) : undefined
}

function indiaDate(epochMs: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(epochMs))
}

function daysBetween(left: string, right: string): number {
  return Math.max(0, Math.floor((Date.parse(`${right}T00:00:00.000Z`) - Date.parse(`${left}T00:00:00.000Z`)) / 86_400_000))
}

export type CreatePortfolioInput = Readonly<{
  displayName: string
  startingCashMinorUnits: string
  mode: string
  strategyVersionId: string
}>

export type ImportHoldingInput = Readonly<{
  instrumentId: string
  quantity: string
  unitCostMinorUnits: string
  acquiredOn: string
}>

export type AssignStrategyInput = Readonly<{ strategyVersionId: string }>
export type ExitPaperHoldingInput = Readonly<{
  instrumentId: string
  quantity: string
  portfolioStateVersion: number
}>
export type SharekhanReconciliationInput = Readonly<{
  confirmation: 'RECONCILE_SHAREKHAN_PAPER'
  brokerAsOf: number
  portfolioStateVersion: number
  availableCashMinorUnits: string
  fallbackAcquiredOn: string
  holdings: readonly Readonly<{
    instrumentId: string
    quantity: string
    unitCostMinorUnits: string
    acquiredOn?: string
  }>[]
}>

export class PortfolioApiApplicationService {
  private readonly owner: PortfolioDatabaseOwner
  private readonly store: PortfolioApiStore
  private readonly now: () => number
  private readonly marketQuotes: ResearchMarketQuoteProvider | undefined
  private readonly marketAnalysis: ResearchMarketAnalysisProvider | undefined
  private readonly operationsApi: PortfolioOperationsApiService

  constructor(
    owner: PortfolioDatabaseOwner,
    now: () => number,
    marketQuotes?: ResearchMarketQuoteProvider,
    marketAnalysis?: ResearchMarketAnalysisProvider,
    operationsBackupDirectory = 'data/portfolio-backups',
  ) {
    this.owner = owner
    this.store = owner.apiStore
    this.now = now
    this.marketQuotes = marketQuotes
    this.marketAnalysis = marketAnalysis
    this.operationsApi = new PortfolioOperationsApiService(owner, now, operationsBackupDirectory)
  }

  list(actorId: string) {
    return Object.freeze({
      portfolios: this.store.listPortfolios(principalId(actorId)),
      strategies: this.store.listStrategyOptions(),
    })
  }

  view(actorId: string, portfolioId: string): unknown | undefined {
    const view = this.store.readPortfolioView(principalId(actorId), portfolioId)
    if (typeof view !== 'object' || view === null) return view
    const record = view as Record<string, unknown>
    const strategies = Array.isArray(record.strategy)
      ? record.strategy.map((item) => {
          if (typeof item !== 'object' || item === null) return item
          const row = item as Record<string, unknown>
          const profile = approvedStrategyProfile(String(row.strategy_version_id ?? ''))
          return Object.freeze({ ...row, ...(profile === undefined ? {} : { approved_profile: profile }) })
        })
      : []
    const performance = typeof record.performance === 'object' && record.performance !== null
      ? record.performance as Record<string, unknown>
      : undefined
    const latestPerformance = typeof performance?.latest === 'object' && performance.latest !== null
      ? performance.latest as Record<string, unknown>
      : undefined
    const performanceStatus = latestPerformance !== undefined
      && String(latestPerformance.observationDate ?? '') !== indiaDate(this.now())
      ? 'STALE'
      : performance?.status
    return Object.freeze({
      ...record,
      strategy: Object.freeze(strategies),
      ...(performance === undefined ? {} : {
        performance: Object.freeze({ ...performance, status: performanceStatus }),
      }),
    })
  }

  operations(actorId: string, portfolioId: string): unknown | undefined {
    const view = this.view(actorId, portfolioId)
    if (view === undefined) return undefined
    const ownerHealth = this.owner.health()
    return Object.freeze({
      database: ownerHealth.ok
        ? Object.freeze({
            state: 'HEALTHY',
            schemaVersion: ownerHealth.value.schemaVersion,
            auditValid: ownerHealth.value.operationsAuditValid,
          })
        : Object.freeze({ state: 'BLOCKED' }),
      alerts: this.store.listSecurityAlerts(50),
      execution: (view as { execution?: unknown }).execution ?? [],
      reconciliation: (view as { reconciliation?: unknown }).reconciliation ?? [],
    })
  }

  async operationsDashboard(actorId: string, portfolioId: string): Promise<unknown | undefined> {
    const view = this.view(actorId, portfolioId)
    if (view === undefined) return undefined
    const ownerHealth = this.owner.health()
    const operations = await this.owner.operations.dashboard(25)
    return Object.freeze({
      database: ownerHealth.ok
        ? Object.freeze({
            state: 'HEALTHY',
            schemaVersion: ownerHealth.value.schemaVersion,
            migrationRegistryChecksum: ownerHealth.value.migrationRegistryChecksum,
            verifiedEventStreams: ownerHealth.value.verifiedEventStreams,
            operationsAuditValid: ownerHealth.value.operationsAuditValid,
          })
        : Object.freeze({ state: 'BLOCKED' }),
      operations,
      securityAlerts: this.store.listSecurityAlerts(50),
      execution: (view as { execution?: unknown }).execution ?? [],
      reconciliation: (view as { reconciliation?: unknown }).reconciliation ?? [],
      brokerReconciliation: (view as { brokerReconciliation?: unknown }).brokerReconciliation ?? [],
    })
  }

  reconcileSharekhanPortfolio(actorId: string, portfolioIdValue: string, input: SharekhanReconciliationInput) {
    const today = indiaDate(this.now())
    const fallbackAcquiredOn = parseLocalDate(input.fallbackAcquiredOn)
    if (
      input.confirmation !== 'RECONCILE_SHAREKHAN_PAPER'
      || !Number.isSafeInteger(input.brokerAsOf)
      || Math.abs(this.now() - input.brokerAsOf) > 15 * 60_000
      || !Number.isSafeInteger(input.portfolioStateVersion)
      || !/^(0|[1-9][0-9]{0,15})$/u.test(input.availableCashMinorUnits)
      || !fallbackAcquiredOn.ok
      || input.fallbackAcquiredOn > today
      || input.holdings.length > 500
    ) return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    const holdings = []
    const instruments = new Set<string>()
    for (const row of input.holdings) {
      const instrumentId = parseInstrumentId(row.instrumentId.trim().toUpperCase())
      const acquiredOn = row.acquiredOn === undefined || row.acquiredOn === ''
        ? undefined
        : parseLocalDate(row.acquiredOn)
      if (
        !instrumentId.ok
        || !String(instrumentId.value).startsWith('NSE:')
        || instruments.has(String(instrumentId.value))
        || !/^[1-9][0-9]{0,11}$/u.test(row.quantity)
        || !/^(0|[1-9][0-9]{0,14})$/u.test(row.unitCostMinorUnits)
        || (acquiredOn !== undefined && (!acquiredOn.ok || row.acquiredOn! > today))
      ) return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
      instruments.add(String(instrumentId.value))
      holdings.push(Object.freeze({
        instrumentId: String(instrumentId.value),
        quantity: row.quantity,
        unitCostMinorUnits: row.unitCostMinorUnits,
        ...(acquiredOn?.ok ? { acquiredOn:String(acquiredOn.value) } : {}),
      }))
    }
    const appliedAt = new Date(this.now()).toISOString()
    const applied = this.store.applyBrokerPortfolioReconciliation({
      reconciliationId: `broker-reconciliation:${randomUUID()}`,
      portfolioId: portfolioIdValue,
      broker: 'SHAREKHAN',
      brokerAsOf: input.brokerAsOf,
      portfolioStateVersion: input.portfolioStateVersion,
      availableCashMinorUnits: input.availableCashMinorUnits,
      fallbackAcquiredOn: input.fallbackAcquiredOn,
      holdings: Object.freeze(holdings),
      appliedAt,
      appliedBy: actorId,
    })
    return applied === undefined
      ? failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
      : success(applied)
  }

  runOperationsHealthCheck(actorId: string, portfolioId: string) {
    return this.operationsApi.runHealthCheck(actorId, portfolioId)
  }

  createOperationsBackup(actorId: string, portfolioId: string) {
    return this.operationsApi.createVerifiedBackup(actorId, portfolioId)
  }

  runOperationsRestorePreflight(actorId: string, portfolioId: string) {
    return this.operationsApi.runRestorePreflight(actorId, portfolioId)
  }

  runOperationsRecoveryScan(actorId: string, portfolioId: string) {
    return this.operationsApi.runRecoveryScan(actorId, portfolioId)
  }

  openOperationsIncident(actorId: string, portfolioId: string, input: Readonly<{
    severity: IncidentSeverity
    code: string
    correlationId: string
  }>) {
    return this.operationsApi.openIncident(actorId, portfolioId, input)
  }

  closeOperationsIncident(actorId: string, portfolioId: string, incidentId: string, actionCodes: readonly string[]) {
    return this.operationsApi.closeIncident(actorId, portfolioId, incidentId, actionCodes)
  }

  create(actorId: string, input: CreatePortfolioInput): DomainResult<Readonly<{
    portfolioId: string
    stateVersion: number
  }>, AnyDomainFailure> {
    if (
      !SAFE_CREATION_MODES.has(input.mode)
      || !/^(0|[1-9][0-9]{0,14})$/u.test(input.startingCashMinorUnits)
      || input.displayName.trim() !== input.displayName
      || input.displayName.length < 1
      || input.displayName.length > 120
    ) return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))

    const strategyOption = this.store.listStrategyOptions().find(
      (item) => item.strategyVersionId === input.strategyVersionId,
    )
    if (strategyOption === undefined) return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))

    try {
      const token = randomUUID()
      const portfolioId = must(parsePortfolioId(`portfolio:${token}`))
      const strategyVersionId = must(parseStrategyVersionId(input.strategyVersionId))
      const effectiveAt = must(parseInstant(new Date(this.now()).toISOString()))
      const issuerId = must(parseActorId(actorId))
      const evidence = must(createStrategyEligibilityEvidence({
        evidenceId: must(parseEvidenceId(`evidence:${randomUUID()}`)),
        portfolioId,
        strategyVersionId,
        issuerId,
        issuedAt: effectiveAt,
        expiresAt: FAR_FUTURE,
        evidenceHash: must(parseIntegrityHash(
          createHash('sha256').update(`strategy:${portfolioId}:${strategyVersionId}:${effectiveAt}`).digest('hex'),
        )),
      }))
      const allocationPolicy = must(createSingleStrategyAllocation(portfolioId, {
        assignmentId: must(parseStrategyAssignmentId(`assignment:${randomUUID()}`)),
        strategyVersionId,
        weight: must(createWeight(1_000_000n)),
        effectiveAt,
        evidenceReference: evidence,
      }))
      const transition = Portfolio.create({
        portfolioId,
        displayName: input.displayName,
        startingCash: must(createMoney(BigInt(input.startingCashMinorUnits), 'INR')),
        mode: input.mode as 'OBSERVE' | 'PAPER' | 'RECOMMENDATION',
        modeEvidence: [],
        allocationPolicy,
        nameUniquenessVerified: true,
        context: {
          commandId: must(parseCommandId(`command:${randomUUID()}`)),
          actorId: issuerId,
          correlationId: must(parseCorrelationId(`correlation:${randomUUID()}`)),
          causationId: must(parseCausationId(`causation:${randomUUID()}`)),
          effectiveAt,
          expectedStateVersion: NO_PORTFOLIO_STATE_VERSION,
        },
        eventId: must(parseEventId(`event:${randomUUID()}`)),
      })
      if (!transition.ok) return transition
      const committed = this.owner.unitOfWork.execute((transaction) => {
        const inserted = transaction.portfolios.insert(transition.value.state)
        if (!inserted.ok) return inserted
        if (!this.store.grantPortfolioAccess(
          principalId(actorId),
          portfolioId,
          'OWNER',
          this.now(),
        )) return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
        const appended = transaction.appendDomainEvents(transition.value.events)
        if (!appended.ok) return appended
        return success(Object.freeze({
          portfolioId: String(portfolioId),
          stateVersion: transition.value.stateVersion,
        }))
      })
      return committed.ok ? success(committed.value.value) : committed
    } catch {
      return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    }
  }

  archive(actorId: string, portfolioIdValue: string, confirmation: string): DomainResult<Readonly<{
    portfolioId: string
    status: string
    stateVersion: number
  }>, AnyDomainFailure> {
    if (confirmation !== 'ARCHIVE') return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    const portfolioId = parsePortfolioId(portfolioIdValue)
    if (!portfolioId.ok) return portfolioId
    const loaded = this.owner.portfolios.getById(portfolioId.value)
    if (!loaded.ok) return loaded
    if (loaded.value === undefined) return failure(persistenceFailure('PORTFOLIO_NOT_FOUND'))
    try {
      const effectiveAt = must(parseInstant(new Date(this.now()).toISOString()))
      const transitioned = loaded.value.archive({
        portfolioId: portfolioId.value,
        context: {
          commandId: must(parseCommandId(`command:${randomUUID()}`)),
          actorId: must(parseActorId(actorId)),
          correlationId: must(parseCorrelationId(`correlation:${randomUUID()}`)),
          causationId: must(parseCausationId(`causation:${randomUUID()}`)),
          effectiveAt,
          expectedStateVersion: loaded.value.stateVersion,
        },
        eventId: must(parseEventId(`event:${randomUUID()}`)),
      })
      if (!transitioned.ok) return transitioned
      if (!transitioned.value.changed) return success(Object.freeze({
        portfolioId: portfolioIdValue,
        status: transitioned.value.state.status,
        stateVersion: transitioned.value.stateVersion,
      }))
      const committed = this.owner.unitOfWork.execute((transaction) => {
        const saved = transaction.portfolios.save(
          transitioned.value.state,
          transitioned.value.priorStateVersion,
        )
        if (!saved.ok) return saved
        const appended = transaction.appendDomainEvents(transitioned.value.events)
        if (!appended.ok) return appended
        return success(Object.freeze({
          portfolioId: portfolioIdValue,
          status: transitioned.value.state.status,
          stateVersion: transitioned.value.stateVersion,
        }))
      })
      return committed.ok ? success(committed.value.value) : committed
    } catch {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
  }

  importHolding(actorId: string, portfolioIdValue: string, input: ImportHoldingInput): DomainResult<Readonly<{
    portfolioId: string
    holdingId: string
    lotId: string
    snapshotStateVersion: number
  }>, AnyDomainFailure> {
    if (
      !/^[1-9][0-9]{0,11}$/u.test(input.quantity)
      || !/^(0|[1-9][0-9]{0,14})$/u.test(input.unitCostMinorUnits)
      || input.instrumentId !== input.instrumentId.trim()
    ) return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    const portfolioId = parsePortfolioId(portfolioIdValue)
    const instrumentId = parseInstrumentId(input.instrumentId.toUpperCase())
    const acquiredOn = parseLocalDate(input.acquiredOn)
    const today = new Date(this.now()).toISOString().slice(0, 10)
    if (!portfolioId.ok || !instrumentId.ok || !acquiredOn.ok || input.acquiredOn > today) {
      return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    }
    const loaded = this.owner.portfolios.getById(portfolioId.value)
    if (!loaded.ok) return loaded
    if (loaded.value === undefined) return failure(persistenceFailure('PORTFOLIO_NOT_FOUND'))
    try {
      const token = randomUUID()
      const holdingId = must(parseHoldingId(`holding:${token}`))
      const lotId = must(parseHoldingLotId(`lot:${token}`))
      const nextStateVersion = must(createPortfolioStateVersion(loaded.value.stateVersion + 1))
      const quantity = must(createQuantity(BigInt(input.quantity)))
      const lot = must(createHoldingLot({
        lotId,
        portfolioId: portfolioId.value,
        instrumentId: instrumentId.value,
        acquiredOn: acquiredOn.value,
        originalQuantity: quantity,
        openQuantity: quantity,
        unitCost: must(createMoney(BigInt(input.unitCostMinorUnits), 'INR')),
        sourceReference: Object.freeze({ kind: 'IMPORT', referenceId: `manual:${token}` }),
      }))
      const holding = must(createHolding({
        holdingId,
        portfolioId: portfolioId.value,
        instrumentId: instrumentId.value,
        totalQuantity: quantity,
        availableDeliveryQuantity: quantity,
        reservedQuantity: must(createQuantity(0n)),
        lots: Object.freeze([lot]),
        stateVersion: nextStateVersion,
        marginFunded: false,
      }))
      const effectiveAt = must(parseInstant(new Date(this.now()).toISOString()))
      const transitioned = loaded.value.importHolding({
        portfolioId: portfolioId.value,
        holding,
        context: {
          commandId: must(parseCommandId(`command:${randomUUID()}`)),
          actorId: must(parseActorId(actorId)),
          correlationId: must(parseCorrelationId(`correlation:${randomUUID()}`)),
          causationId: must(parseCausationId(`causation:${randomUUID()}`)),
          effectiveAt,
          expectedStateVersion: loaded.value.stateVersion,
        },
        eventId: must(parseEventId(`event:${randomUUID()}`)),
      })
      if (!transitioned.ok) return transitioned
      const committed = this.owner.unitOfWork.execute((transaction) => {
        const saved = transaction.portfolios.save(
          transitioned.value.state,
          transitioned.value.priorStateVersion,
        )
        if (!saved.ok) return saved
        const appended = transaction.appendDomainEvents(transitioned.value.events)
        if (!appended.ok) return appended
        return success(Object.freeze({
          portfolioId: portfolioIdValue,
          holdingId: String(holdingId),
          lotId: String(lotId),
          snapshotStateVersion: transitioned.value.stateVersion,
        }))
      })
      return committed.ok ? success(committed.value.value) : committed
    } catch {
      return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    }
  }

  assignStrategy(actorId: string, portfolioIdValue: string, input: AssignStrategyInput): DomainResult<Readonly<{
    portfolioId: string
    strategyVersionId: string
    stateVersion: number
    changed: boolean
  }>, AnyDomainFailure> {
    const portfolioId = parsePortfolioId(portfolioIdValue)
    const strategyVersionId = parseStrategyVersionId(input.strategyVersionId)
    if (!portfolioId.ok || !strategyVersionId.ok || approvedStrategyProfile(input.strategyVersionId) === undefined) {
      return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    }
    if (!this.store.listStrategyOptions().some((item) => item.strategyVersionId === input.strategyVersionId)) {
      return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    }
    const loaded = this.owner.portfolios.getById(portfolioId.value)
    if (!loaded.ok) return loaded
    if (loaded.value === undefined) return failure(persistenceFailure('PORTFOLIO_NOT_FOUND'))
    const current = loaded.value.allocationPolicy
    if (current.kind === 'SINGLE' && current.strategyVersionId === strategyVersionId.value) {
      return success(Object.freeze({
        portfolioId: portfolioIdValue,
        strategyVersionId: input.strategyVersionId,
        stateVersion: loaded.value.stateVersion,
        changed: false,
      }))
    }
    try {
      const effectiveAt = must(parseInstant(new Date(this.now()).toISOString()))
      const issuerId = must(parseActorId(actorId))
      const evidence = must(createStrategyEligibilityEvidence({
        evidenceId: must(parseEvidenceId(`evidence:${randomUUID()}`)),
        portfolioId: portfolioId.value,
        strategyVersionId: strategyVersionId.value,
        issuerId,
        issuedAt: effectiveAt,
        expiresAt: FAR_FUTURE,
        evidenceHash: must(parseIntegrityHash(createHash('sha256')
          .update(`approved-preset:${portfolioIdValue}:${input.strategyVersionId}:${effectiveAt}`)
          .digest('hex'))),
      }))
      const allocationPolicy = must(createSingleStrategyAllocation(portfolioId.value, {
        assignmentId: must(parseStrategyAssignmentId(`assignment:${randomUUID()}`)),
        strategyVersionId: strategyVersionId.value,
        weight: must(createWeight(1_000_000n)),
        effectiveAt,
        evidenceReference: evidence,
      }))
      const transitioned = loaded.value.replaceStrategyAllocation({
        portfolioId: portfolioId.value,
        allocationPolicy,
        context: {
          commandId: must(parseCommandId(`command:${randomUUID()}`)),
          actorId: issuerId,
          correlationId: must(parseCorrelationId(`correlation:${randomUUID()}`)),
          causationId: must(parseCausationId(`causation:${randomUUID()}`)),
          effectiveAt,
          expectedStateVersion: loaded.value.stateVersion,
        },
        eventId: must(parseEventId(`event:${randomUUID()}`)),
      })
      if (!transitioned.ok) return transitioned
      const committed = this.owner.unitOfWork.execute((transaction) => {
        const saved = transaction.portfolios.save(transitioned.value.state, transitioned.value.priorStateVersion)
        if (!saved.ok) return saved
        const appended = transaction.appendDomainEvents(transitioned.value.events)
        if (!appended.ok) return appended
        return success(Object.freeze({
          portfolioId: portfolioIdValue,
          strategyVersionId: input.strategyVersionId,
          stateVersion: transitioned.value.stateVersion,
          changed: true,
        }))
      })
      return committed.ok ? success(committed.value.value) : committed
    } catch {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
  }

  async generateResearchRebalance(actorId: string, portfolioIdValue: string): Promise<DomainResult<unknown, AnyDomainFailure>> {
    if (this.marketAnalysis === undefined) return this.generateQuoteOnlyResearchFallback(actorId, portfolioIdValue)
    const portfolioId = parsePortfolioId(portfolioIdValue)
    if (!portfolioId.ok) return portfolioId
    const loaded = this.owner.portfolios.getById(portfolioId.value)
    if (!loaded.ok) return loaded
    const portfolio = loaded.value
    if (portfolio === undefined) return failure(persistenceFailure('PORTFOLIO_NOT_FOUND'))
    if (portfolio.status !== 'ACTIVE' || (portfolio.holdings.length === 0 && portfolio.cash.minorUnits <= 0n)) {
      return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    }
    const allocation = portfolio.allocationPolicy
    if (allocation.kind !== 'SINGLE') return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    const profile = approvedStrategyProfile(String(allocation.strategyVersionId))
    if (profile === undefined) return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    const symbolByInstrument = new Map<string, string>()
    for (const holding of portfolio.holdings) {
      const symbol = marketSymbol(String(holding.instrumentId))
      if (symbol === undefined) return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
      symbolByInstrument.set(String(holding.instrumentId), symbol)
    }
    let universe
    const calculatedAt = new Date(this.now()).toISOString()
    try {
      universe = await this.marketAnalysis(Object.freeze({
        indexUniverse: profile.config.universe.indexUniverse,
        benchmark: profile.config.benchmark,
        includeSymbols: Object.freeze([...new Set(symbolByInstrument.values())]),
        targetHoldings: profile.config.construction.targetHoldings,
        ...(profile.config.strategicRebalance === undefined ? {} : {
          strategicBenchmarks: Object.freeze({
            riskBenchmark: profile.config.strategicRebalance.riskBenchmark,
            defensiveBenchmark: profile.config.strategicRebalance.defensiveBenchmark,
          }),
        }),
      }))
    } catch {
      return failure(persistenceFailure('PERSISTENCE_OPERATION_FAILED'))
    }
    const currentSymbols = new Set(symbolByInstrument.values())
    const strategicPolicy = profile.config.strategicRebalance
    const priorStrategicObservation = strategicPolicy === undefined
      ? undefined : this.store.readLatestStrategicRebalanceObservation(portfolioIdValue)
    let strategicSnapshot: StrategicRebalanceSnapshot | undefined = strategicPolicy === undefined
      ? undefined
      : calculateStrategicRebalanceSnapshot({
          policy: strategicPolicy,
          now: calculatedAt,
          ...(universe.strategicBenchmarkHistory === undefined ? {} : { history: universe.strategicBenchmarkHistory }),
          ...(priorStrategicObservation === undefined ? {} : { priorDelay: Object.freeze({
            state: priorStrategicObservation.state,
            delayStartedOn: priorStrategicObservation.delayStartedOn,
          }) }),
        })
    const scoredCandidates = selectResearchCandidates({ candidates: universe.candidates, config: profile.config, currentSymbols })
    const candidateBySymbol = new Map(scoredCandidates.map((candidate) => [candidate.symbol, candidate]))
    if ([...currentSymbols].some((symbol) => candidateBySymbol.get(symbol) === undefined)) {
      return failure(persistenceFailure('PERSISTENCE_OPERATION_FAILED'))
    }
    const selectedCandidates = scoredCandidates
      .filter((candidate) => candidate.selected)
      .sort((left, right) => (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER))
    if (selectedCandidates.length === 0) return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    const holdingBySymbol = new Map(portfolio.holdings.map((holding) => [
      symbolByInstrument.get(String(holding.instrumentId)) as string,
      holding,
    ]))
    const priceBySymbol = new Map<string, bigint>()
    for (const candidate of scoredCandidates) {
      const price = priceMinorUnits(candidate.price)
      if (price !== undefined) priceBySymbol.set(candidate.symbol, price)
    }
    const currentMarketValue = portfolio.holdings.reduce((total, holding) => {
      const symbol = symbolByInstrument.get(String(holding.instrumentId)) ?? ''
      return total + holding.totalQuantity.shares * (priceBySymbol.get(symbol) ?? 0n)
    }, 0n)
    const nav = portfolio.cash.minorUnits + currentMarketValue
    if (nav <= 0n) return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    const config = profile.config
    const asOf = indiaDate(this.now())
    const exposurePpm = BigInt(Math.round((100 - config.construction.cashBufferPct) * 10_000))
    const maximumStockPpm = BigInt(Math.round(config.eligibility.maxStockWeightPct * 10_000))
    const minimumHoldProtectedSymbols = new Set(portfolio.holdings
      .filter((holding) => {
        const symbol = symbolByInstrument.get(String(holding.instrumentId)) ?? ''
        return candidateBySymbol.get(symbol)?.selected !== true
          && holding.lots.some((lot) => daysBetween(lot.acquiredOn, asOf) < config.rebalance.preferredMinHoldDays)
      })
      .map((holding) => symbolByInstrument.get(String(holding.instrumentId)) ?? ''))
    const protectedCapital = portfolio.holdings.reduce((total, holding) => {
      const symbol = symbolByInstrument.get(String(holding.instrumentId)) ?? ''
      return minimumHoldProtectedSymbols.has(symbol)
        ? total + holding.totalQuantity.shares * (priceBySymbol.get(symbol) ?? 0n)
        : total
    }, 0n)
    const desiredExposureValue = nav * exposurePpm / 1_000_000n
    const allocatableSelectedValue = desiredExposureValue > protectedCapital ? desiredExposureValue - protectedCapital : 0n
    const equalTargetValue = allocatableSelectedValue / BigInt(selectedCandidates.length)
    const maximumStockValue = nav * maximumStockPpm / 1_000_000n
    const strategicTargetValue = equalTargetValue < maximumStockValue ? equalTargetValue : maximumStockValue
    const strategicWeightPpm = strategicTargetValue * 1_000_000n / nav
    const actionSymbols = new Set([...currentSymbols, ...selectedCandidates.map((candidate) => candidate.symbol)])
    const drafts = [...actionSymbols].map((symbol) => {
      const candidate = candidateBySymbol.get(symbol)
      const holding = holdingBySymbol.get(symbol)
      const price = priceBySymbol.get(symbol) ?? 0n
      const currentQuantity = holding?.totalQuantity.shares ?? 0n
      const strategicTargetQuantity = candidate?.selected && price > 0n ? strategicTargetValue / price : 0n
      const currentValue = currentQuantity * price
      const targetValue = strategicTargetQuantity * price
      const costBasis = holding?.lots.reduce((total, lot) => total + lot.openQuantity.shares * lot.unitCost.minorUnits, 0n) ?? 0n
      const unrealizedPnlPct = costBasis > 0n ? Number((currentValue - costBasis) * 10_000n / costBasis) / 100 : null
      const currentWeightPct = Number(currentValue * 10_000n / nav) / 100
      const exitRisk: PositionExitRiskAssessment = holding === undefined || candidate === undefined
        ? Object.freeze({ level:'NONE', score:0, mandatoryExit:false, flags:Object.freeze([]), summary:'No active exit-risk criterion.' })
        : assessPositionExitRisk({ candidate, config, currentWeightPct, unrealizedPnlPct })
      const riskAdjustedTargetQuantity = exitRisk.level === 'EXIT'
        ? 0n
        : exitRisk.level === 'REDUCE'
          ? (strategicTargetQuantity < currentQuantity / 2n ? strategicTargetQuantity : currentQuantity / 2n)
          : exitRisk.level === 'WATCH'
            ? (strategicTargetQuantity < currentQuantity ? strategicTargetQuantity : currentQuantity)
            : strategicTargetQuantity
      const strategicTiming = strategicPolicy === undefined || strategicSnapshot === undefined
        ? undefined
        : applyStrategicTradeTiming({
            currentQuantity,
            preTimingTargetQuantity: riskAdjustedTargetQuantity,
            mandatoryExit: exitRisk.mandatoryExit,
            policy: strategicPolicy,
            snapshot: strategicSnapshot,
          })
      const timingAdjustedTargetQuantity = strategicTiming?.timedTargetQuantity ?? riskAdjustedTargetQuantity
      const driftPpm = nav > 0n ? (currentValue > targetValue ? currentValue - targetValue : targetValue - currentValue) * 1_000_000n / nav : 0n
      const absoluteBandPpm = BigInt(Math.round(config.eligibility.noTradeBandPctPoints * 10_000))
      const fractionalBandPpm = strategicWeightPpm * BigInt(Math.round(config.eligibility.noTradeBandFractionOfTarget * 1_000_000)) / 1_000_000n
      const noTradeBandPpm = absoluteBandPpm > fractionalBandPpm ? absoluteBandPpm : fractionalBandPpm
      const stagedByNoTradeBand = holding !== undefined && candidate?.selected === true && exitRisk.level === 'NONE' && driftPpm <= noTradeBandPpm
      const protectedByMinimumHold = holding !== undefined && candidate?.selected !== true
        && !exitRisk.mandatoryExit
        && minimumHoldProtectedSymbols.has(symbol)
      const desiredQuantity = stagedByNoTradeBand || protectedByMinimumHold ? currentQuantity : timingAdjustedTargetQuantity
      return {
        symbol, candidate, holding, price, currentQuantity, strategicTargetQuantity,
        desiredQuantity, targetQuantity: desiredQuantity, stagedByNoTradeBand, protectedByMinimumHold, exitRisk, strategicTiming,
      }
    })
    const turnoverLimit = nav * BigInt(Math.round(config.rebalance.maxDailyTurnoverPct * 10_000)) / 1_000_000n
    const cashBuffer = nav * BigInt(Math.round(config.construction.cashBufferPct * 10_000)) / 1_000_000n
    const surplusCash = portfolio.cash.minorUnits > cashBuffer ? portfolio.cash.minorUnits - cashBuffer : 0n
    let remainingSellTurnover = turnoverLimit
    for (const draft of drafts
      .filter((item) => item.desiredQuantity < item.currentQuantity)
      .sort((left, right) => Number(right.exitRisk.mandatoryExit) - Number(left.exitRisk.mandatoryExit)
        || right.exitRisk.score - left.exitRisk.score
        || (right.candidate?.rank ?? Number.MAX_SAFE_INTEGER) - (left.candidate?.rank ?? Number.MAX_SAFE_INTEGER))) {
      const desiredShares = draft.currentQuantity - draft.desiredQuantity
      const allowedShares = strategicPolicy !== undefined && draft.exitRisk.mandatoryExit
        ? desiredShares : draft.price > 0n ? remainingSellTurnover / draft.price : 0n
      const stagedShares = desiredShares < allowedShares ? desiredShares : allowedShares
      draft.targetQuantity = draft.currentQuantity - stagedShares
      const usedTurnover = stagedShares * draft.price
      remainingSellTurnover = usedTurnover >= remainingSellTurnover ? 0n : remainingSellTurnover - usedTurnover
    }
    const stagedGrossSell = drafts.reduce((total, draft) => draft.targetQuantity < draft.currentQuantity
      ? total + (draft.currentQuantity - draft.targetQuantity) * draft.price
      : total, 0n)
    const surplusCashDeploymentLimit = surplusCash + stagedGrossSell
    const buyTurnoverLimit = surplusCashDeploymentLimit > turnoverLimit ? surplusCashDeploymentLimit : turnoverLimit
    let remainingBuyTurnover = buyTurnoverLimit
    let availableForBuys = portfolio.cash.minorUnits + stagedGrossSell
    for (const draft of drafts
      .filter((item) => item.desiredQuantity > item.currentQuantity)
      .sort((left, right) => (left.candidate?.rank ?? Number.MAX_SAFE_INTEGER) - (right.candidate?.rank ?? Number.MAX_SAFE_INTEGER))) {
      const desiredShares = draft.desiredQuantity - draft.currentQuantity
      const turnoverShares = draft.price > 0n ? remainingBuyTurnover / draft.price : 0n
      const cashShares = draft.price > 0n ? availableForBuys / draft.price : 0n
      const stagedShares = [desiredShares, turnoverShares, cashShares].reduce((smallest, value) => value < smallest ? value : smallest)
      draft.targetQuantity = draft.currentQuantity + stagedShares
      const notional = stagedShares * draft.price
      remainingBuyTurnover -= notional
      availableForBuys -= notional
    }
    const calculateActions = () => drafts.map((draft) => {
      const { symbol, candidate, holding, price, currentQuantity, strategicTargetQuantity, desiredQuantity, targetQuantity } = draft
      const instrumentId = holding === undefined ? `NSE:${symbol}` : String(holding.instrumentId)
      const currentValue = currentQuantity * price
      const targetValue = targetQuantity * price
      const deltaQuantity = targetQuantity - currentQuantity
      const grossNotional = (deltaQuantity < 0n ? -deltaQuantity : deltaQuantity) * price
      const side = deltaQuantity > 0n ? 'BUY' : deltaQuantity < 0n ? targetQuantity === 0n ? 'SELL' : 'REDUCE' : 'HOLD'
      const sttPct = side === 'BUY' ? config.tax.sttBuyPct : config.tax.sttSellPct
      const chargeRatePpm = BigInt(Math.round(sttPct * 10_000)) + 500n
      const charges = side === 'HOLD' ? 0n : grossNotional * chargeRatePpm / 1_000_000n
      let tax = 0n
      let realizedPnl = 0n
      if (deltaQuantity < 0n && holding !== undefined) {
        let remaining = -deltaQuantity
        for (const lot of holding.lots) {
          if (remaining === 0n) break
          const selected = remaining < lot.openQuantity.shares ? remaining : lot.openQuantity.shares
          const gain = selected * (price - lot.unitCost.minorUnits)
          realizedPnl += gain
          if (gain > 0n) {
            const ratePct = daysBetween(lot.acquiredOn, asOf) >= 365 ? config.tax.ltcgRatePct : config.tax.stcgRatePct
            tax += gain * BigInt(Math.round(ratePct * 10_000)) / 1_000_000n
          }
          remaining -= selected
        }
      }
      const quantityExplanation = holding === undefined
        ? targetQuantity === 0n && (draft.strategicTiming?.delayedQuantity ?? 0n) > 0n
          ? `Do not open this holding in the current session; ${draft.strategicTiming!.delayedQuantity.toString()} shares are delayed by strategic trend timing.`
          : `Open a new holding with ${targetQuantity.toString()} shares.`
        : deltaQuantity > 0n
          ? `Increase the existing holding from ${currentQuantity.toString()} to ${targetQuantity.toString()} shares by buying ${deltaQuantity.toString()} additional shares.`
          : deltaQuantity < 0n
            ? `Reduce the existing holding from ${currentQuantity.toString()} to ${targetQuantity.toString()} shares by selling ${(-deltaQuantity).toString()} shares.`
            : `Keep the existing holding unchanged at ${currentQuantity.toString()} shares.`
      const strategyExplanation = draft.protectedByMinimumHold
        ? `Exit deferred until the preset preferred ${config.rebalance.preferredMinHoldDays}-day holding period is met.`
        : draft.stagedByNoTradeBand
          ? 'Trade suppressed because drift remains inside the preset no-trade band.'
          : draft.exitRisk.level !== 'NONE'
            ? draft.exitRisk.summary
            : candidate?.selectionReason ?? 'Current holding lacks a complete research candidate record.'
      return Object.freeze({
        instrumentId, symbol, action: side,
        currentQuantity: currentQuantity.toString(), targetQuantity: targetQuantity.toString(),
        strategicTargetQuantity: strategicTargetQuantity.toString(), deltaQuantity: deltaQuantity.toString(),
        preTimingTargetQuantity: draft.strategicTiming?.preTimingTargetQuantity.toString(),
        timedTargetQuantity: draft.strategicTiming?.timedTargetQuantity.toString(),
        strategicTimingClassification: draft.strategicTiming?.classification,
        strategicTimingFraction: draft.strategicTiming?.appliedFraction,
        delayedQuantity: draft.strategicTiming?.delayedQuantity.toString() ?? '0',
        delayedNotionalMinorUnits: ((draft.strategicTiming?.delayedQuantity ?? 0n) * price).toString(),
        strategicTimingReasonCode: draft.strategicTiming?.reasonCode,
        presentationAction: draft.strategicTiming?.delayedQuantity && draft.strategicTiming.delayedQuantity > 0n && deltaQuantity === 0n ? 'DELAYED' : undefined,
        livePriceMinorUnits: price.toString(), currentValueMinorUnits: currentValue.toString(), targetValueMinorUnits: targetValue.toString(),
        currentWeightPpm: (currentValue * 1_000_000n / nav).toString(), targetWeightPpm: (targetValue * 1_000_000n / nav).toString(),
        estimatedChargesMinorUnits: charges.toString(), estimatedTaxMinorUnits: tax.toString(),
        realizedPnlMinorUnits: realizedPnl.toString(),
        strategyRank: candidate?.rank ?? null, strategyScore: candidate?.score ?? null,
        momentumScore: candidate?.momentumScore ?? null, qualityScore: candidate?.qualityScore ?? null,
        valuationScore: candidate?.valuationScore ?? null,
        earningsScore: candidate?.earningsScore ?? null, sectorScore: candidate?.sectorScore ?? null,
        catalystScore: candidate?.catalystScore ?? null,
        lowRiskScore: candidate?.lowRiskScore ?? null, dataCoveragePct: candidate?.dataCoveragePct ?? 0,
        catalystScanCoveragePct: candidate?.catalystScanCoveragePct ?? 0,
        isNewOpportunity: holding === undefined && candidate?.selected === true,
        stagedByTurnoverLimit: targetQuantity !== desiredQuantity,
        stagedByNoTradeBand: draft.stagedByNoTradeBand,
        protectedByMinimumHold: draft.protectedByMinimumHold,
        exitRiskLevel:draft.exitRisk.level,
        exitRiskScore:draft.exitRisk.score,
        exitRiskFlags:draft.exitRisk.flags,
        exitRiskSummary:draft.exitRisk.summary,
        mandatoryExit:draft.exitRisk.mandatoryExit,
        reasonCode: draft.protectedByMinimumHold ? 'PREFERRED_MINIMUM_HOLD'
          : draft.stagedByNoTradeBand ? 'NO_TRADE_BAND'
          : side === 'HOLD' ? candidate?.selected ? 'NO_TRADE_REQUIRED' : 'TURNOVER_LIMIT_STAGED'
          : holding === undefined ? 'STRATEGY_ENTRY'
            : draft.exitRisk.mandatoryExit ? 'RISK_EXIT_REQUIRED'
              : draft.exitRisk.level === 'EXIT' ? 'RISK_EXIT'
                : draft.exitRisk.level === 'REDUCE' ? 'RISK_REDUCTION'
                  : candidate?.selected ? 'TARGET_WEIGHT_REBALANCE' : 'STRATEGY_EXIT',
        explanation: `${quantityExplanation} ${strategyExplanation}${draft.strategicTiming === undefined ? '' : ` Strategic timing: ${draft.strategicTiming.reasonCode}.`}`,
      })
    })
    let actions = calculateActions()
    const totals = () => Object.freeze({
      grossBuy: actions.reduce((total, action) => BigInt(action.deltaQuantity) > 0n ? total + BigInt(action.deltaQuantity) * BigInt(action.livePriceMinorUnits) : total, 0n),
      grossSell: actions.reduce((total, action) => BigInt(action.deltaQuantity) < 0n ? total + (-BigInt(action.deltaQuantity)) * BigInt(action.livePriceMinorUnits) : total, 0n),
      charges: actions.reduce((total, action) => total + BigInt(action.estimatedChargesMinorUnits), 0n),
      tax: actions.reduce((total, action) => total + BigInt(action.estimatedTaxMinorUnits), 0n),
    })
    let amounts = totals()
    let projectedCash = portfolio.cash.minorUnits + amounts.grossSell - amounts.grossBuy - amounts.charges - amounts.tax
    if (projectedCash < 0n) {
      let deficit = -projectedCash
      for (const draft of drafts.filter((item) => item.targetQuantity > item.currentQuantity)
        .sort((left, right) => (right.candidate?.rank ?? Number.MAX_SAFE_INTEGER) - (left.candidate?.rank ?? Number.MAX_SAFE_INTEGER))) {
        if (deficit <= 0n || draft.price <= 0n) break
        const boughtShares = draft.targetQuantity - draft.currentQuantity
        const sharesToRemove = (deficit + draft.price - 1n) / draft.price
        const removed = boughtShares < sharesToRemove ? boughtShares : sharesToRemove
        draft.targetQuantity -= removed
        deficit -= removed * draft.price
      }
      actions = calculateActions()
      amounts = totals()
      projectedCash = portfolio.cash.minorUnits + amounts.grossSell - amounts.grossBuy - amounts.charges - amounts.tax
    }
    if (projectedCash < 0n) return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    const delayedBuyMinorUnits = drafts.reduce((total, draft) => total + (draft.strategicTiming?.delayedQuantity ?? 0n) * draft.price, 0n)
    if (strategicSnapshot !== undefined) strategicSnapshot = withStrategicCashImpact(strategicSnapshot, delayedBuyMinorUnits)
    const createdAt = calculatedAt
    const hashInput = Object.freeze({
      portfolioId: portfolioIdValue, portfolioStateVersion: portfolio.stateVersion,
      strategyVersionId: String(allocation.strategyVersionId), strategyConfigHash: profile.configHash,
      asOf: universe.asOf,
      researchModelVersion: universe.researchModelVersion ?? SIX_FACTOR_RESEARCH_MODEL.version,
      strategicRebalance: strategicSnapshot,
      candidates: scoredCandidates.map((candidate) => Object.freeze({ symbol: candidate.symbol, rank: candidate.rank, score: candidate.score, selected: candidate.selected })),
      actions,
    })
    const planHash = createHash('sha256').update(canonicalJson(hashInput)).digest('hex')
    const planId = `plan:${randomUUID()}`
    const rebalanceRunId = `rebalance-run:${randomUUID()}`
    const payload = Object.freeze({
      planId, rebalanceRunId, portfolioId: portfolioIdValue, portfolioStateVersion: portfolio.stateVersion,
      strategyVersionId: String(allocation.strategyVersionId), strategyConfigHash: profile.configHash,
      planHash, state: 'PREVIEW_READY', scope: 'STRATEGY_UNIVERSE_RESEARCH',
      ...(strategicSnapshot === undefined ? {} : { strategicRebalance: strategicSnapshot }),
      marketData: Object.freeze({
        source: 'YAHOO_RESEARCH', asOf: universe.asOf, executionEligible: false,
        indexUniverse: universe.indexUniverse, benchmark: universe.benchmark,
        constituentCount: universe.constituentCount, analyzedCount: universe.analyzedCount,
        eligibleCount: scoredCandidates.filter((candidate) => candidate.eligible).length,
        researchModelVersion: universe.researchModelVersion ?? SIX_FACTOR_RESEARCH_MODEL.version,
        researchModelWeights: SIX_FACTOR_RESEARCH_MODEL.factorWeights,
        catalystScanCoveragePct: universe.catalystScanCoveragePct ?? 0,
      }),
      constraints: Object.freeze({
        cashBufferPct: config.construction.cashBufferPct, maxStockWeightPct: config.eligibility.maxStockWeightPct,
        targetHoldings: config.construction.targetHoldings, maxHoldings: config.construction.maxHoldings,
        preferredMinHoldDays: config.rebalance.preferredMinHoldDays, maxDailyTurnoverPct: config.rebalance.maxDailyTurnoverPct,
        replacementScoreGapPct: config.construction.replacementScoreGapPct,
        buyTurnoverLimitMinorUnits: buyTurnoverLimit.toString(),
        surplusCashDeploymentMinorUnits: surplusCash.toString(),
        minimumHoldProtectedCapitalMinorUnits: protectedCapital.toString(),
        ...(strategicPolicy === undefined ? {} : {
          strategicPermittedRebalanceFraction: strategicPolicy.permittedRebalanceFraction,
          strategicNegativeTrendBuyFraction: strategicPolicy.negativeTrendBuyFraction,
        }),
      }),
      summary: Object.freeze({
        navMinorUnits: nav.toString(), currentMarketValueMinorUnits: currentMarketValue.toString(),
        grossBuyMinorUnits: amounts.grossBuy.toString(), grossSellMinorUnits: amounts.grossSell.toString(),
        estimatedChargesMinorUnits: amounts.charges.toString(), estimatedTaxMinorUnits: amounts.tax.toString(),
        projectedCashMinorUnits: projectedCash.toString(), selectedHoldings: String(selectedCandidates.length),
        newOpportunities: String(actions.filter((action) => action.isNewOpportunity).length),
        delayedBuyMinorUnits: delayedBuyMinorUnits.toString(),
        retainedCashMinorUnits: strategicSnapshot?.retainedCashMinorUnits ?? '0',
      }),
      actions: Object.freeze(actions),
      topCandidates: Object.freeze(scoredCandidates.filter((candidate) => candidate.eligible)
        .sort((left, right) => (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER))
        .slice(0, 20)
        .map((candidate) => Object.freeze({
          symbol: candidate.symbol, name: candidate.name ?? candidate.symbol, sector: candidate.sector ?? null,
          rank: candidate.rank, score: candidate.score, momentumScore: candidate.momentumScore,
          qualityScore: candidate.qualityScore, earningsScore: candidate.earningsScore,
          valuationScore: candidate.valuationScore,
          sectorScore: candidate.sectorScore, catalystScore: candidate.catalystScore, lowRiskScore: candidate.lowRiskScore,
          dataCoveragePct: candidate.dataCoveragePct, currentlyHeld: candidate.currentlyHeld,
          catalystScanCoveragePct: candidate.catalystScanCoveragePct ?? 0,
          selected: candidate.selected, selectionReason: candidate.selectionReason, evidence: candidate.evidence ?? [],
        }))),
      warnings: Object.freeze([
        'NSE constituents and Yahoo market/fundamental history are research data, not licensed point-in-time execution data.',
        'Missing factor components are neutralized and disclosed through each candidate data-coverage percentage.',
        'Daily turnover limits stage portfolio churn, while surplus cash above the configured buffer can be deployed immediately.',
        'Exit-risk flags combine strategy rank, P/L, trend, earnings, verified catalysts, drawdown, volatility, leverage, concentration, event risk, and data coverage. They remain PAPER recommendations.',
        ...(strategicSnapshot === undefined ? [] : [strategicSnapshot.headline, 'Strategic timing never delays a mandatory risk exit.']),
        ...universe.warnings,
        'Approval records PAPER intent only and never enables live broker execution.',
      ]),
      createdAt, createdBy: actorId,
    })
    const saved = this.store.saveResearchRebalancePlan({
      plan: Object.freeze({
        planId, rebalanceRunId, portfolioId: portfolioIdValue, portfolioStateVersion: portfolio.stateVersion,
        strategyVersionId: String(allocation.strategyVersionId), planHash, marketDataSource: 'YAHOO_RESEARCH',
        marketDataAsOf: universe.asOf, state: 'PREVIEW_READY', canonicalPayload: payload, createdAt, createdBy: actorId,
      }),
      eventId: `plan-event:${randomUUID()}`,
      supersedeEventId: `plan-event:${randomUUID()}`,
      ...(strategicSnapshot === undefined ? {} : {
        strategicObservation: Object.freeze({
          observationId: `strategic-observation:${randomUUID()}`,
          portfolioId: portfolioIdValue,
          planId,
          policyVersion: strategicSnapshot.policyVersion,
          decisionSessionDate: strategicSnapshot.decisionSessionDate,
          state: strategicSnapshot.state,
          riskBenchmark: strategicSnapshot.riskBenchmark,
          defensiveBenchmark: strategicSnapshot.defensiveBenchmark,
          signal: strategicSnapshot as unknown as Readonly<Record<string, unknown>>,
          dataHash: strategicSnapshot.dataHash,
          delayedBuyMinorUnits: strategicSnapshot.delayedBuyMinorUnits,
          retainedCashMinorUnits: strategicSnapshot.retainedCashMinorUnits,
          delayStartedOn: strategicSnapshot.delayStartedOn,
          createdAt,
          createdBy: actorId,
        }),
      }),
    })
    return saved ? success(payload) : failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
  }

  private async generateQuoteOnlyResearchFallback(actorId: string, portfolioIdValue: string): Promise<DomainResult<unknown, AnyDomainFailure>> {
    if (this.marketQuotes === undefined) return failure(persistenceFailure('PERSISTENCE_OPERATION_FAILED'))
    const portfolioId = parsePortfolioId(portfolioIdValue)
    if (!portfolioId.ok) return portfolioId
    const loaded = this.owner.portfolios.getById(portfolioId.value)
    if (!loaded.ok) return loaded
    const portfolio = loaded.value
    if (portfolio === undefined) return failure(persistenceFailure('PORTFOLIO_NOT_FOUND'))
    if (portfolio.status !== 'ACTIVE' || portfolio.holdings.length === 0) {
      return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    }
    const allocation = portfolio.allocationPolicy
    if (allocation.kind !== 'SINGLE') return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    const profile = approvedStrategyProfile(String(allocation.strategyVersionId))
    if (profile === undefined || portfolio.holdings.length > profile.config.construction.maxHoldings) {
      return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    }
    const symbolByInstrument = new Map<string, string>()
    for (const holding of portfolio.holdings) {
      const symbol = marketSymbol(String(holding.instrumentId))
      if (symbol === undefined) return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
      symbolByInstrument.set(String(holding.instrumentId), symbol)
    }
    let quoteResult: Awaited<ReturnType<ResearchMarketQuoteProvider>>
    try {
      quoteResult = await this.marketQuotes(Object.freeze([...new Set(symbolByInstrument.values())]))
    } catch {
      return failure(persistenceFailure('PERSISTENCE_OPERATION_FAILED'))
    }
    const priceByInstrument = new Map<string, bigint>()
    for (const [instrumentId, symbol] of symbolByInstrument) {
      const price = priceMinorUnits(quoteResult.quotes[symbol]?.price ?? Number.NaN)
      if (price === undefined) return failure(persistenceFailure('PERSISTENCE_OPERATION_FAILED'))
      priceByInstrument.set(instrumentId, price)
    }
    const currentMarketValue = portfolio.holdings.reduce((total, holding) =>
      total + holding.totalQuantity.shares * (priceByInstrument.get(String(holding.instrumentId)) ?? 0n), 0n)
    const nav = portfolio.cash.minorUnits + currentMarketValue
    if (nav <= 0n) return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    const config = profile.config
    const exposurePpm = BigInt(Math.round((100 - config.construction.cashBufferPct) * 10_000))
    const maximumStockPpm = BigInt(Math.round(config.eligibility.maxStockWeightPct * 10_000))
    const equalWeightPpm = exposurePpm / BigInt(portfolio.holdings.length)
    const targetWeightPpm = equalWeightPpm < maximumStockPpm ? equalWeightPpm : maximumStockPpm
    const asOf = indiaDate(this.now())
    let grossBuy = 0n
    let grossSell = 0n
    let estimatedCharges = 0n
    let estimatedTax = 0n
    const actions = portfolio.holdings.map((holding) => {
      const instrumentId = String(holding.instrumentId)
      const price = priceByInstrument.get(instrumentId) ?? 0n
      const currentQuantity = holding.totalQuantity.shares
      const currentValue = currentQuantity * price
      const targetValueBeforeShares = nav * targetWeightPpm / 1_000_000n
      const targetQuantity = price === 0n ? 0n : targetValueBeforeShares / price
      const targetValue = targetQuantity * price
      const deltaQuantity = targetQuantity - currentQuantity
      const grossNotional = (deltaQuantity < 0n ? -deltaQuantity : deltaQuantity) * price
      const side = deltaQuantity > 0n ? 'BUY' : deltaQuantity < 0n
        ? targetQuantity === 0n ? 'SELL' : 'REDUCE'
        : 'HOLD'
      const sttPct = side === 'BUY' ? config.tax.sttBuyPct : config.tax.sttSellPct
      const chargeRatePpm = BigInt(Math.round(sttPct * 10_000)) + 500n
      const charges = side === 'HOLD' ? 0n : grossNotional * chargeRatePpm / 1_000_000n
      let tax = 0n
      let realizedPnl = 0n
      if (deltaQuantity < 0n) {
        let remaining = -deltaQuantity
        for (const lot of holding.lots) {
          if (remaining === 0n) break
          const selected = remaining < lot.openQuantity.shares ? remaining : lot.openQuantity.shares
          const gain = selected * (price - lot.unitCost.minorUnits)
          realizedPnl += gain
          if (gain > 0n) {
            const ratePct = daysBetween(lot.acquiredOn, asOf) >= 365
              ? config.tax.ltcgRatePct
              : config.tax.stcgRatePct
            tax += gain * BigInt(Math.round(ratePct * 10_000)) / 1_000_000n
          }
          remaining -= selected
        }
      }
      if (deltaQuantity > 0n) grossBuy += grossNotional
      if (deltaQuantity < 0n) grossSell += grossNotional
      estimatedCharges += charges
      estimatedTax += tax
      return Object.freeze({
        instrumentId,
        symbol: symbolByInstrument.get(instrumentId),
        action: side,
        currentQuantity: currentQuantity.toString(),
        targetQuantity: targetQuantity.toString(),
        deltaQuantity: deltaQuantity.toString(),
        livePriceMinorUnits: price.toString(),
        currentValueMinorUnits: currentValue.toString(),
        targetValueMinorUnits: targetValue.toString(),
        currentWeightPpm: (currentValue * 1_000_000n / nav).toString(),
        targetWeightPpm: targetWeightPpm.toString(),
        estimatedChargesMinorUnits: charges.toString(),
        estimatedTaxMinorUnits: tax.toString(),
        realizedPnlMinorUnits: realizedPnl.toString(),
        reasonCode: side === 'HOLD' ? 'NO_TRADE_REQUIRED' : 'TARGET_WEIGHT_REBALANCE',
        explanation: side === 'HOLD'
          ? 'Current whole-share quantity already matches the drift-only research target.'
          : 'Whole-share target applies the selected preset cash buffer and maximum stock weight.',
      })
    })
    const createdAt = new Date(this.now()).toISOString()
    const projectedCash = portfolio.cash.minorUnits + grossSell - grossBuy - estimatedCharges - estimatedTax
    if (projectedCash < 0n) return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    const hashInput = Object.freeze({
      portfolioId: portfolioIdValue,
      portfolioStateVersion: portfolio.stateVersion,
      strategyVersionId: String(allocation.strategyVersionId),
      strategyConfigHash: profile.configHash,
      asOf,
      prices: Object.freeze(Object.fromEntries([...priceByInstrument].map(([key, value]) => [key, value.toString()]))),
      actions,
    })
    const planHash = createHash('sha256').update(canonicalJson(hashInput)).digest('hex')
    const planId = `plan:${randomUUID()}`
    const rebalanceRunId = `rebalance-run:${randomUUID()}`
    const payload = Object.freeze({
      planId,
      rebalanceRunId,
      portfolioId: portfolioIdValue,
      portfolioStateVersion: portfolio.stateVersion,
      strategyVersionId: String(allocation.strategyVersionId),
      strategyConfigHash: profile.configHash,
      planHash,
      state: 'PREVIEW_READY',
      scope: 'CURRENT_HOLDINGS_QUOTE_FALLBACK',
      marketData: Object.freeze({
        source: 'YAHOO_RESEARCH',
        asOf: createdAt,
        executionEligible: false,
        quoteCount: priceByInstrument.size,
      }),
      constraints: Object.freeze({
        cashBufferPct: config.construction.cashBufferPct,
        maxStockWeightPct: config.eligibility.maxStockWeightPct,
        targetHoldings: config.construction.targetHoldings,
        maxHoldings: config.construction.maxHoldings,
        preferredMinHoldDays: config.rebalance.preferredMinHoldDays,
        maxDailyTurnoverPct: config.rebalance.maxDailyTurnoverPct,
      }),
      summary: Object.freeze({
        navMinorUnits: nav.toString(),
        currentMarketValueMinorUnits: currentMarketValue.toString(),
        grossBuyMinorUnits: grossBuy.toString(),
        grossSellMinorUnits: grossSell.toString(),
        estimatedChargesMinorUnits: estimatedCharges.toString(),
        estimatedTaxMinorUnits: estimatedTax.toString(),
        projectedCashMinorUnits: projectedCash.toString(),
      }),
      actions: Object.freeze(actions),
      warnings: Object.freeze([
        'Yahoo quotes are research data and are not licensed point-in-time execution data.',
        'Strategy-universe analysis is unavailable in this runtime; this explicit fallback can only price existing holdings.',
        'Approval records PAPER intent only and never enables live broker execution.',
      ]),
      createdAt,
      createdBy: actorId,
    })
    const saved = this.store.saveResearchRebalancePlan({
      plan: Object.freeze({
        planId,
        rebalanceRunId,
        portfolioId: portfolioIdValue,
        portfolioStateVersion: portfolio.stateVersion,
        strategyVersionId: String(allocation.strategyVersionId),
        planHash,
        marketDataSource: 'YAHOO_RESEARCH',
        marketDataAsOf: createdAt,
        state: 'PREVIEW_READY',
        canonicalPayload: payload,
        createdAt,
        createdBy: actorId,
      }),
      eventId: `plan-event:${randomUUID()}`,
      supersedeEventId: `plan-event:${randomUUID()}`,
    })
    return saved ? success(payload) : failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
  }

  approveResearchRebalance(actorId: string, portfolioIdValue: string, planId: string): DomainResult<unknown, AnyDomainFailure> {
    const current = this.store.readCurrentResearchRebalancePlan(portfolioIdValue)
    if (current?.planId !== planId || !['PREVIEW_READY', 'APPROVED_PAPER'].includes(current.state)) {
      return failure(persistenceFailure('PERSISTENCE_VERSION_CONFLICT'))
    }
    const strategic = (current.canonicalPayload as Record<string, unknown>)['strategicRebalance']
    if (typeof strategic === 'object' && strategic !== null && (strategic as Record<string, unknown>)['approvalBlocked'] === true) {
      return failure(persistenceFailure('PERSISTENCE_VERSION_CONFLICT'))
    }
    const approved = this.store.approveResearchRebalancePlan({
      portfolioId: portfolioIdValue,
      planId,
      actorId,
      eventId: `plan-event:${randomUUID()}`,
      occurredAt: new Date(this.now()).toISOString(),
    })
    if (!approved) return failure(persistenceFailure('PERSISTENCE_VERSION_CONFLICT'))
    return success(Object.freeze({
      ...(current.canonicalPayload as Record<string, unknown>),
      state: 'APPROVED_PAPER',
    }))
  }

  async refreshPerformance(actorId: string, portfolioIdValue: string): Promise<DomainResult<unknown, AnyDomainFailure>> {
    if (this.marketQuotes === undefined) return failure(persistenceFailure('PERSISTENCE_OPERATION_FAILED'))
    const portfolioId = parsePortfolioId(portfolioIdValue)
    if (!portfolioId.ok) return portfolioId
    const loaded = this.owner.portfolios.getById(portfolioId.value)
    if (!loaded.ok) return loaded
    const portfolio = loaded.value
    if (portfolio === undefined) return failure(persistenceFailure('PORTFOLIO_NOT_FOUND'))
    const allocation = portfolio.allocationPolicy
    if (allocation.kind !== 'SINGLE') return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    const profile = approvedStrategyProfile(String(allocation.strategyVersionId))
    if (profile === undefined) return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    const benchmarkSymbol = benchmarkMarketSymbol(profile.config.benchmark)
    const symbols = portfolio.holdings.map((holding) => marketSymbol(String(holding.instrumentId)))
    if (symbols.some((symbol) => symbol === undefined)) return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    let quoteResult: Awaited<ReturnType<ResearchMarketQuoteProvider>>
    try {
      quoteResult = await this.marketQuotes(Object.freeze([...new Set([
        ...(symbols as string[]),
        benchmarkSymbol,
      ])]))
    } catch {
      return failure(persistenceFailure('PERSISTENCE_OPERATION_FAILED'))
    }
    const benchmarkQuote = quoteResult.quotes[benchmarkSymbol]
    const benchmarkPrice = priceMinorUnits(benchmarkQuote?.price ?? Number.NaN)
    if (benchmarkPrice === undefined) return failure(persistenceFailure('PERSISTENCE_OPERATION_FAILED'))
    const performanceHoldings = portfolio.holdings.map((holding) => {
      const symbol = marketSymbol(String(holding.instrumentId)) as string
      const quote = quoteResult.quotes[symbol]
      const price = priceMinorUnits(quote?.price ?? Number.NaN)
      const previousClose = priceMinorUnits(quote?.prevClose ?? quote?.price ?? Number.NaN)
      if (price === undefined || previousClose === undefined) throw new Error('INCOMPLETE_PERFORMANCE_QUOTES')
      return Object.freeze({
        instrumentId: String(holding.instrumentId),
        quantity: holding.totalQuantity.shares,
        costBasisMinorUnits: holding.lots.reduce(
          (total, lot) => total + lot.openQuantity.shares * lot.unitCost.minorUnits,
          0n,
        ),
        priceMinorUnits: price,
        previousCloseMinorUnits: previousClose,
      })
    })
    const observedAt = new Date(this.now()).toISOString()
    let observation
    try {
      observation = createPerformanceObservation({
        observationId: `performance:${randomUUID()}`,
        portfolioId: portfolioIdValue,
        observedAt,
        observationDate: indiaDate(this.now()),
        portfolioStateVersion: portfolio.stateVersion,
        cashMinorUnits: portfolio.cash.minorUnits,
        benchmarkSymbol,
        benchmarkPriceMinorUnits: benchmarkPrice,
        holdings: Object.freeze(performanceHoldings),
        accounting: this.store.readPerformanceAccounting(portfolioIdValue),
        history: this.store.readPerformanceObservations(portfolioIdValue),
        createdBy: actorId,
      })
    } catch {
      return failure(persistenceFailure('PERSISTENCE_OPERATION_FAILED'))
    }
    return this.store.savePerformanceObservation(observation)
      ? success(observation)
      : failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
  }

  async exitPaperHolding(
    actorId: string,
    portfolioIdValue: string,
    input: ExitPaperHoldingInput,
  ): Promise<DomainResult<unknown, AnyDomainFailure>> {
    if (
      this.marketQuotes === undefined
      || !/^[1-9][0-9]*$/u.test(input.quantity)
      || !Number.isSafeInteger(input.portfolioStateVersion)
      || input.portfolioStateVersion < 1
    ) return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    const portfolioId = parsePortfolioId(portfolioIdValue)
    const instrumentId = parseInstrumentId(input.instrumentId)
    if (!portfolioId.ok) return portfolioId
    if (!instrumentId.ok) return instrumentId
    const loaded = this.owner.portfolios.getById(portfolioId.value)
    if (!loaded.ok) return loaded
    const portfolio = loaded.value
    if (
      portfolio === undefined
      || portfolio.status !== 'ACTIVE'
      || portfolio.mode !== 'PAPER'
      || portfolio.stateVersion !== input.portfolioStateVersion
    ) return failure(persistenceFailure('PERSISTENCE_VERSION_CONFLICT'))
    const holding = portfolio.holdings.find((item) => String(item.instrumentId) === input.instrumentId)
    const quantity = BigInt(input.quantity)
    if (
      holding === undefined
      || quantity > holding.totalQuantity.shares
      || quantity > holding.availableDeliveryQuantity.shares
    ) return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    const allocation = portfolio.allocationPolicy
    if (allocation.kind !== 'SINGLE') return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    const profile = approvedStrategyProfile(String(allocation.strategyVersionId))
    if (profile === undefined) return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    const symbol = marketSymbol(input.instrumentId)
    if (symbol === undefined) return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    let quoteResult: Awaited<ReturnType<ResearchMarketQuoteProvider>>
    try {
      quoteResult = await this.marketQuotes(Object.freeze([symbol]))
    } catch {
      return failure(persistenceFailure('PERSISTENCE_OPERATION_FAILED'))
    }
    const price = priceMinorUnits(quoteResult.quotes[symbol]?.price ?? Number.NaN)
    if (price === undefined) return failure(persistenceFailure('PERSISTENCE_OPERATION_FAILED'))
    const asOf = indiaDate(this.now())
    let remaining = quantity
    let releasedCostBasis = 0n
    let realizedPnl = 0n
    let tax = 0n
    const lots = [...holding.lots].sort((left, right) =>
      String(left.acquiredOn).localeCompare(String(right.acquiredOn))
      || String(left.lotId).localeCompare(String(right.lotId)))
    for (const lot of lots) {
      if (remaining === 0n) break
      const sold = remaining < lot.openQuantity.shares ? remaining : lot.openQuantity.shares
      const cost = sold * lot.unitCost.minorUnits
      const gain = sold * price - cost
      releasedCostBasis += cost
      realizedPnl += gain
      if (gain > 0n) {
        const ratePct = daysBetween(lot.acquiredOn, asOf) >= 365
          ? profile.config.tax.ltcgRatePct
          : profile.config.tax.stcgRatePct
        tax += gain * BigInt(Math.round(ratePct * 10_000)) / 1_000_000n
      }
      remaining -= sold
    }
    if (remaining !== 0n) return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    const grossProceeds = quantity * price
    const chargeRatePpm = BigInt(Math.round(profile.config.tax.sttSellPct * 10_000)) + 500n
    const charges = grossProceeds * chargeRatePpm / 1_000_000n
    const netProceeds = grossProceeds - charges - tax
    const currentPlan = this.store.readCurrentResearchRebalancePlan(portfolioIdValue)
    const currentPlanPayload = currentPlan?.portfolioStateVersion === portfolio.stateVersion
      && typeof currentPlan.canonicalPayload === 'object'
      && currentPlan.canonicalPayload !== null
      ? currentPlan.canonicalPayload as { actions?: readonly Record<string, unknown>[] }
      : undefined
    const riskAction = currentPlanPayload?.actions?.find((action) => action.instrumentId === input.instrumentId)
    const riskLevel = String(riskAction?.exitRiskLevel ?? 'NONE')
    const reasonCode = riskLevel === 'EXIT'
      ? 'STRATEGY_RISK_EXIT' as const
      : riskLevel === 'REDUCE'
        ? 'STRATEGY_RISK_REDUCTION' as const
        : 'USER_REQUESTED' as const
    const executedAt = new Date(this.now()).toISOString()
    const exit = Object.freeze({
      exitId: `manual-exit:${randomUUID()}`,
      portfolioId: portfolioIdValue,
      holdingId: String(holding.holdingId),
      instrumentId: input.instrumentId,
      quantity: quantity.toString(),
      executionPriceMinorUnits: price.toString(),
      grossProceedsMinorUnits: grossProceeds.toString(),
      releasedCostBasisMinorUnits: releasedCostBasis.toString(),
      realizedPnlMinorUnits: realizedPnl.toString(),
      chargesMinorUnits: charges.toString(),
      taxMinorUnits: tax.toString(),
      netProceedsMinorUnits: netProceeds.toString(),
      portfolioStateVersionBefore: portfolio.stateVersion,
      portfolioStateVersionAfter: portfolio.stateVersion + 1,
      exitKind: quantity === holding.totalQuantity.shares ? 'FULL' as const : 'PARTIAL' as const,
      reasonCode,
      riskSnapshot: Object.freeze({
        planId: currentPlan?.planId ?? null,
        exitRiskLevel: riskLevel,
        exitRiskSummary: riskAction?.exitRiskSummary ?? null,
        mandatoryExit: riskAction?.mandatoryExit === true,
      }),
      marketDataSource: 'YAHOO_RESEARCH' as const,
      executedAt,
      executedBy: actorId,
    })
    return this.store.executeManualPaperExit(exit)
      ? success(exit)
      : failure(persistenceFailure('PERSISTENCE_VERSION_CONFLICT'))
  }
}
