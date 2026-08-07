import type Database from 'better-sqlite3'

import type { ApprovalDecisionSnapshot } from '../../domain/execution/approval.ts'
import type { NormalizedFill } from '../../domain/execution/contracts.ts'
import type {
  CancellationAttemptRecord,
  CancellationOutcomeRecord,
  ExecutionOrderSnapshot,
} from '../../domain/execution/execution-order.ts'
import type { ExecutionRunSnapshot } from '../../domain/execution/execution-run.ts'
import type {
  KillSwitchScope,
  KillSwitchSnapshot,
} from '../../domain/execution/kill-switch.ts'
import type {
  ReconciliationRunSnapshot,
  ReconciliationSnapshotRecord,
} from '../../domain/execution/reconciliation.ts'
import type {
  AdjustmentProposal,
  ResidualWork,
} from '../../domain/execution/residual-and-adjustment.ts'
import { failure, success } from '../../domain/errors/result.ts'
import type {
  AdjustmentProposalId,
  ApprovalId,
  BrokerOrderReferenceId,
  CancellationId,
  ExecutionRunId,
  FillId,
  KillSwitchId,
  OrderId,
  PortfolioId,
  ReconciliationRunId,
  ReconciliationSnapshotId,
  ResidualWorkId,
} from '../../domain/shared/identifiers.ts'
import type {
  AdjustmentProposalRepository,
  CancellationFactRepository,
  ExecutionApprovalRepository,
  ExecutionOrderRepository,
  ExecutionRunRepository,
  FillFactRepository,
  KillSwitchRepository,
  ReconciliationRunRepository,
  ReconciliationSnapshotRepository,
  ResidualWorkRepository,
} from '../../ports/execution/execution-unit-of-work.ts'
import {
  persistenceFailure,
  type PersistenceResult,
} from '../../infrastructure/persistence/failures.ts'
import type {
  ExecutionAggregateKind,
  ExecutionFactKind,
  TransactionMutation,
} from './unit-of-work.ts'
import {
  decodeAdjustmentProposal,
  decodeCancellationOutcome,
  decodeCancellationRequest,
  decodeExecutionApproval,
  decodeExecutionFill,
  decodeExecutionOrder,
  decodeExecutionRun,
  decodeKillSwitch,
  decodeReconciliationRun,
  decodeReconciliationSnapshot,
  decodeResidualWork,
  encodeAdjustmentProposal,
  encodeCancellationOutcome,
  encodeCancellationRequest,
  encodeExecutionApproval,
  encodeExecutionFill,
  encodeExecutionOrder,
  encodeExecutionRun,
  encodeKillSwitch,
  encodeReconciliationRun,
  encodeReconciliationSnapshot,
  encodeResidualWork,
} from './execution-codecs.ts'
import { EXECUTION_SQL } from './execution-statement-catalog.ts'

type PayloadRow = Readonly<{ canonical_payload: string }>
type MutationRecorder = (mutation: TransactionMutation) => void

function unavailable(): PersistenceResult<never> {
  return failure(persistenceFailure('PERSISTENCE_CAPABILITY_LEAK'))
}

function optimisticFailure(): PersistenceResult<never> {
  return failure(persistenceFailure('PERSISTENCE_VERSION_CONFLICT', {
    retryability: 'AFTER_STATE_REFRESH',
  }))
}

abstract class TransactionRepository {
  protected readonly database: Database.Database
  protected readonly recordMutation: MutationRecorder
  private readonly canAccess: () => boolean

  public constructor(
    database: Database.Database,
    canAccess: () => boolean,
    recordMutation: MutationRecorder,
  ) {
    this.database = database
    this.canAccess = canAccess
    this.recordMutation = recordMutation
  }

  protected accessible(): boolean {
    return this.canAccess()
  }

  protected payload(sql: string, ...parameters: readonly unknown[]): PayloadRow | undefined {
    return this.database.prepare(sql).get(...parameters) as PayloadRow | undefined
  }

  protected payloads(sql: string, ...parameters: readonly unknown[]): readonly PayloadRow[] {
    return this.database.prepare(sql).all(...parameters) as readonly PayloadRow[]
  }

  protected recordAggregate(
    aggregateKind: ExecutionAggregateKind,
    aggregateId: string,
    portfolioId: string | undefined,
    stateVersion: number,
    kind: 'INSERT' | 'SAVE',
  ): void {
    this.recordMutation(Object.freeze({
      category: 'EXECUTION_AGGREGATE',
      aggregateKind,
      aggregateId,
      ...(portfolioId !== undefined ? { portfolioId } : {}),
      stateVersion,
      kind,
    }))
  }

  protected recordFact(
    factKind: ExecutionFactKind,
    factId: string,
    portfolioId: string,
  ): void {
    this.recordMutation(Object.freeze({
      category: 'EXECUTION_FACT',
      factKind,
      factId,
      portfolioId,
    }))
  }
}

export class SqliteExecutionApprovalRepository
  extends TransactionRepository
  implements ExecutionApprovalRepository {
  public insert(snapshot: ApprovalDecisionSnapshot): PersistenceResult<void> {
    if (!this.accessible()) return unavailable()
    const encoded = encodeExecutionApproval(snapshot)
    const existing = this.payload(EXECUTION_SQL.selectApproval, snapshot.approvalId)
    if (existing !== undefined) {
      return existing.canonical_payload === encoded
        ? success(undefined)
        : failure(persistenceFailure('PERSISTENCE_DUPLICATE'))
    }
    try {
      this.database.prepare(EXECUTION_SQL.insertApproval).run(
        snapshot.approvalId,
        snapshot.portfolioId,
        snapshot.rebalanceRunId,
        snapshot.state,
        snapshot.decisionKind,
        snapshot.idempotencyKey,
        snapshot.consumedByExecutionRunId ?? null,
        snapshot.stateVersion,
        encoded,
      )
      this.recordAggregate(
        'APPROVAL',
        snapshot.approvalId,
        snapshot.portfolioId,
        snapshot.stateVersion,
        'INSERT',
      )
      return success(undefined)
    } catch {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
  }

  public getById(approvalId: ApprovalId): PersistenceResult<ApprovalDecisionSnapshot | undefined> {
    if (!this.accessible()) return unavailable()
    const row = this.payload(EXECUTION_SQL.selectApproval, approvalId)
    return row === undefined ? success(undefined) : decodeExecutionApproval(row.canonical_payload)
  }

  public findActiveByPortfolio(
    portfolioId: PortfolioId,
  ): PersistenceResult<ApprovalDecisionSnapshot | undefined> {
    if (!this.accessible()) return unavailable()
    const row = this.payload(EXECUTION_SQL.selectActiveApproval, portfolioId)
    return row === undefined ? success(undefined) : decodeExecutionApproval(row.canonical_payload)
  }

  public save(
    snapshot: ApprovalDecisionSnapshot,
    expectedStateVersion: number,
  ): PersistenceResult<void> {
    if (!this.accessible()) return unavailable()
    if (snapshot.stateVersion !== expectedStateVersion + 1) return optimisticFailure()
    try {
      const result = this.database.prepare(EXECUTION_SQL.updateApproval).run(
        snapshot.state,
        snapshot.decisionKind,
        snapshot.consumedByExecutionRunId ?? null,
        snapshot.stateVersion,
        encodeExecutionApproval(snapshot),
        snapshot.approvalId,
        expectedStateVersion,
      )
      if (result.changes !== 1) return optimisticFailure()
      this.recordAggregate(
        'APPROVAL',
        snapshot.approvalId,
        snapshot.portfolioId,
        snapshot.stateVersion,
        'SAVE',
      )
      return success(undefined)
    } catch {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
  }
}

export class SqliteExecutionRunRepository
  extends TransactionRepository
  implements ExecutionRunRepository {
  public insert(snapshot: ExecutionRunSnapshot): PersistenceResult<void> {
    if (!this.accessible()) return unavailable()
    const encoded = encodeExecutionRun(snapshot)
    const existing = this.payload(EXECUTION_SQL.selectRun, snapshot.executionRunId)
    if (existing !== undefined) {
      return existing.canonical_payload === encoded
        ? success(undefined)
        : failure(persistenceFailure('PERSISTENCE_DUPLICATE'))
    }
    try {
      this.database.prepare(EXECUTION_SQL.insertRun).run(
        snapshot.executionRunId,
        snapshot.portfolioId,
        snapshot.approvalId,
        snapshot.state,
        snapshot.mode,
        snapshot.portfolioStateVersion,
        snapshot.stateVersion,
        snapshot.updatedAt,
        encoded,
      )
      this.recordAggregate(
        'EXECUTION_RUN',
        snapshot.executionRunId,
        snapshot.portfolioId,
        snapshot.stateVersion,
        'INSERT',
      )
      return success(undefined)
    } catch {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
  }

  private decode(row: PayloadRow | undefined): PersistenceResult<ExecutionRunSnapshot | undefined> {
    return row === undefined ? success(undefined) : decodeExecutionRun(row.canonical_payload)
  }

  public getById(executionRunId: ExecutionRunId): PersistenceResult<ExecutionRunSnapshot | undefined> {
    if (!this.accessible()) return unavailable()
    return this.decode(this.payload(EXECUTION_SQL.selectRun, executionRunId))
  }

  public findActiveByPortfolio(portfolioId: PortfolioId): PersistenceResult<ExecutionRunSnapshot | undefined> {
    if (!this.accessible()) return unavailable()
    return this.decode(this.payload(EXECUTION_SQL.selectActiveRun, portfolioId))
  }

  public findByApprovalId(approvalId: ApprovalId): PersistenceResult<ExecutionRunSnapshot | undefined> {
    if (!this.accessible()) return unavailable()
    return this.decode(this.payload(EXECUTION_SQL.selectRunByApproval, approvalId))
  }

  public listActive(): PersistenceResult<readonly ExecutionRunSnapshot[]> {
    if (!this.accessible()) return unavailable()
    const values: ExecutionRunSnapshot[] = []
    for (const row of this.payloads(EXECUTION_SQL.selectActiveRuns)) {
      const decoded = decodeExecutionRun(row.canonical_payload)
      if (!decoded.ok) return decoded
      values.push(decoded.value)
    }
    return success(Object.freeze(values))
  }

  public save(snapshot: ExecutionRunSnapshot, expectedStateVersion: number): PersistenceResult<void> {
    if (!this.accessible()) return unavailable()
    if (snapshot.stateVersion !== expectedStateVersion + 1) return optimisticFailure()
    try {
      const result = this.database.prepare(EXECUTION_SQL.updateRun).run(
        snapshot.state,
        snapshot.portfolioStateVersion,
        snapshot.stateVersion,
        snapshot.updatedAt,
        encodeExecutionRun(snapshot),
        snapshot.executionRunId,
        expectedStateVersion,
      )
      if (result.changes !== 1) return optimisticFailure()
      this.recordAggregate(
        'EXECUTION_RUN',
        snapshot.executionRunId,
        snapshot.portfolioId,
        snapshot.stateVersion,
        'SAVE',
      )
      return success(undefined)
    } catch {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
  }
}

export class SqliteExecutionOrderRepository
  extends TransactionRepository
  implements ExecutionOrderRepository {
  public insert(snapshot: ExecutionOrderSnapshot): PersistenceResult<void> {
    if (!this.accessible()) return unavailable()
    const encoded = encodeExecutionOrder(snapshot)
    const existing = this.payload(EXECUTION_SQL.selectOrder, snapshot.orderId)
    if (existing !== undefined) {
      return existing.canonical_payload === encoded
        ? success(undefined)
        : failure(persistenceFailure('PERSISTENCE_DUPLICATE'))
    }
    try {
      this.database.prepare(EXECUTION_SQL.insertOrder).run(
        snapshot.orderId,
        snapshot.executionRunId,
        snapshot.portfolioId,
        snapshot.instrumentId,
        snapshot.side,
        snapshot.state,
        snapshot.logicalOrderKey,
        snapshot.idempotencyKey,
        snapshot.sequence,
        snapshot.approvedQuantityCeiling.shares.toString(10),
        snapshot.filledQuantity.shares.toString(10),
        snapshot.brokerReference?.brokerOrderReferenceId ?? null,
        snapshot.stateVersion,
        encoded,
      )
      this.recordAggregate(
        'EXECUTION_ORDER',
        snapshot.orderId,
        snapshot.portfolioId,
        snapshot.stateVersion,
        'INSERT',
      )
      return success(undefined)
    } catch {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
  }

  private decode(row: PayloadRow | undefined): PersistenceResult<ExecutionOrderSnapshot | undefined> {
    return row === undefined ? success(undefined) : decodeExecutionOrder(row.canonical_payload)
  }

  private decodeMany(rows: readonly PayloadRow[]): PersistenceResult<readonly ExecutionOrderSnapshot[]> {
    const values: ExecutionOrderSnapshot[] = []
    for (const row of rows) {
      const decoded = decodeExecutionOrder(row.canonical_payload)
      if (!decoded.ok) return decoded
      values.push(decoded.value)
    }
    return success(Object.freeze(values))
  }

  public getById(orderId: OrderId): PersistenceResult<ExecutionOrderSnapshot | undefined> {
    if (!this.accessible()) return unavailable()
    return this.decode(this.payload(EXECUTION_SQL.selectOrder, orderId))
  }

  public listByRun(executionRunId: ExecutionRunId): PersistenceResult<readonly ExecutionOrderSnapshot[]> {
    if (!this.accessible()) return unavailable()
    return this.decodeMany(this.payloads(EXECUTION_SQL.selectOrdersByRun, executionRunId))
  }

  public findByBrokerReference(
    portfolioId: PortfolioId,
    brokerOrderReferenceId: BrokerOrderReferenceId,
  ): PersistenceResult<ExecutionOrderSnapshot | undefined> {
    if (!this.accessible()) return unavailable()
    return this.decode(this.payload(
      EXECUTION_SQL.selectOrderByBrokerReference,
      portfolioId,
      brokerOrderReferenceId,
    ))
  }

  public listCancellableByScope(
    scope: KillSwitchScope,
  ): PersistenceResult<readonly ExecutionOrderSnapshot[]> {
    if (!this.accessible()) return unavailable()
    return scope.kind === 'GLOBAL'
      ? this.decodeMany(this.payloads(EXECUTION_SQL.selectGlobalCancellableOrders))
      : this.decodeMany(this.payloads(
          EXECUTION_SQL.selectPortfolioCancellableOrders,
          scope.portfolioId,
        ))
  }

  public save(snapshot: ExecutionOrderSnapshot, expectedStateVersion: number): PersistenceResult<void> {
    if (!this.accessible()) return unavailable()
    if (snapshot.stateVersion !== expectedStateVersion + 1) return optimisticFailure()
    try {
      const result = this.database.prepare(EXECUTION_SQL.updateOrder).run(
        snapshot.state,
        snapshot.filledQuantity.shares.toString(10),
        snapshot.brokerReference?.brokerOrderReferenceId ?? null,
        snapshot.stateVersion,
        encodeExecutionOrder(snapshot),
        snapshot.orderId,
        expectedStateVersion,
      )
      if (result.changes !== 1) return optimisticFailure()
      this.recordAggregate(
        'EXECUTION_ORDER',
        snapshot.orderId,
        snapshot.portfolioId,
        snapshot.stateVersion,
        'SAVE',
      )
      return success(undefined)
    } catch {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
  }
}

export class SqliteReconciliationRunRepository
  extends TransactionRepository
  implements ReconciliationRunRepository {
  public insert(snapshot: ReconciliationRunSnapshot): PersistenceResult<void> {
    if (!this.accessible()) return unavailable()
    const encoded = encodeReconciliationRun(snapshot)
    const existing = this.payload(
      EXECUTION_SQL.selectReconciliationRun,
      snapshot.reconciliationRunId,
    )
    if (existing !== undefined) {
      return existing.canonical_payload === encoded
        ? success(undefined)
        : failure(persistenceFailure('PERSISTENCE_DUPLICATE'))
    }
    try {
      this.database.prepare(EXECUTION_SQL.insertReconciliationRun).run(
        snapshot.reconciliationRunId,
        snapshot.portfolioId,
        snapshot.state,
        snapshot.reason,
        snapshot.startedAt,
        snapshot.completedAt ?? null,
        snapshot.priorRunId ?? null,
        snapshot.stateVersion,
        encoded,
      )
      this.recordAggregate(
        'RECONCILIATION_RUN',
        snapshot.reconciliationRunId,
        snapshot.portfolioId,
        snapshot.stateVersion,
        'INSERT',
      )
      return success(undefined)
    } catch {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
  }

  private decode(
    row: PayloadRow | undefined,
  ): PersistenceResult<ReconciliationRunSnapshot | undefined> {
    return row === undefined ? success(undefined) : decodeReconciliationRun(row.canonical_payload)
  }

  public getById(
    reconciliationRunId: ReconciliationRunId,
  ): PersistenceResult<ReconciliationRunSnapshot | undefined> {
    if (!this.accessible()) return unavailable()
    return this.decode(this.payload(EXECUTION_SQL.selectReconciliationRun, reconciliationRunId))
  }

  public findLatestByPortfolio(
    portfolioId: PortfolioId,
  ): PersistenceResult<ReconciliationRunSnapshot | undefined> {
    if (!this.accessible()) return unavailable()
    return this.decode(this.payload(EXECUTION_SQL.selectLatestReconciliationRun, portfolioId))
  }

  public save(
    snapshot: ReconciliationRunSnapshot,
    expectedStateVersion: number,
  ): PersistenceResult<void> {
    if (!this.accessible()) return unavailable()
    if (snapshot.stateVersion !== expectedStateVersion + 1) return optimisticFailure()
    try {
      const result = this.database.prepare(EXECUTION_SQL.updateReconciliationRun).run(
        snapshot.state,
        snapshot.completedAt ?? null,
        snapshot.stateVersion,
        encodeReconciliationRun(snapshot),
        snapshot.reconciliationRunId,
        expectedStateVersion,
      )
      if (result.changes !== 1) return optimisticFailure()
      this.recordAggregate(
        'RECONCILIATION_RUN',
        snapshot.reconciliationRunId,
        snapshot.portfolioId,
        snapshot.stateVersion,
        'SAVE',
      )
      return success(undefined)
    } catch {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
  }
}

export class SqliteReconciliationSnapshotRepository
  extends TransactionRepository
  implements ReconciliationSnapshotRepository {
  public insert(record: ReconciliationSnapshotRecord): PersistenceResult<void> {
    if (!this.accessible()) return unavailable()
    const encoded = encodeReconciliationSnapshot(record)
    const existing = this.payload(EXECUTION_SQL.selectReconciliationSnapshot, record.snapshotId)
    if (existing !== undefined) {
      return existing.canonical_payload === encoded
        ? success(undefined)
        : failure(persistenceFailure('PERSISTENCE_DUPLICATE'))
    }
    try {
      this.database.prepare(EXECUTION_SQL.insertReconciliationSnapshot).run(
        record.snapshotId,
        record.portfolioId,
        record.source,
        record.contentHash,
        record.capturedAt,
        encoded,
      )
      this.recordFact('RECONCILIATION_SNAPSHOT', record.snapshotId, record.portfolioId)
      return success(undefined)
    } catch {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
  }

  public getById(
    snapshotId: ReconciliationSnapshotId,
  ): PersistenceResult<ReconciliationSnapshotRecord | undefined> {
    if (!this.accessible()) return unavailable()
    const row = this.payload(EXECUTION_SQL.selectReconciliationSnapshot, snapshotId)
    return row === undefined ? success(undefined) : decodeReconciliationSnapshot(row.canonical_payload)
  }
}

export class SqliteKillSwitchRepository
  extends TransactionRepository
  implements KillSwitchRepository {
  public insert(snapshot: KillSwitchSnapshot): PersistenceResult<void> {
    if (!this.accessible()) return unavailable()
    const encoded = encodeKillSwitch(snapshot)
    const existing = this.payload(EXECUTION_SQL.selectKillSwitch, snapshot.killSwitchId)
    if (existing !== undefined) {
      return existing.canonical_payload === encoded
        ? success(undefined)
        : failure(persistenceFailure('PERSISTENCE_DUPLICATE'))
    }
    const portfolioId = snapshot.scope.kind === 'PORTFOLIO'
      ? snapshot.scope.portfolioId
      : undefined
    try {
      this.database.prepare(EXECUTION_SQL.insertKillSwitch).run(
        snapshot.killSwitchId,
        snapshot.scope.kind,
        portfolioId ?? null,
        snapshot.state,
        snapshot.stateVersion,
        encoded,
      )
      this.recordAggregate(
        'KILL_SWITCH',
        snapshot.killSwitchId,
        portfolioId,
        snapshot.stateVersion,
        'INSERT',
      )
      return success(undefined)
    } catch {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
  }

  public getById(killSwitchId: KillSwitchId): PersistenceResult<KillSwitchSnapshot | undefined> {
    if (!this.accessible()) return unavailable()
    const row = this.payload(EXECUTION_SQL.selectKillSwitch, killSwitchId)
    return row === undefined ? success(undefined) : decodeKillSwitch(row.canonical_payload)
  }

  public findByScope(scope: KillSwitchScope): PersistenceResult<KillSwitchSnapshot | undefined> {
    if (!this.accessible()) return unavailable()
    const row = scope.kind === 'GLOBAL'
      ? this.payload(EXECUTION_SQL.selectGlobalKillSwitch)
      : this.payload(EXECUTION_SQL.selectPortfolioKillSwitch, scope.portfolioId)
    return row === undefined ? success(undefined) : decodeKillSwitch(row.canonical_payload)
  }

  public save(snapshot: KillSwitchSnapshot, expectedStateVersion: number): PersistenceResult<void> {
    if (!this.accessible()) return unavailable()
    if (snapshot.stateVersion !== expectedStateVersion + 1) return optimisticFailure()
    const portfolioId = snapshot.scope.kind === 'PORTFOLIO'
      ? snapshot.scope.portfolioId
      : undefined
    try {
      const result = this.database.prepare(EXECUTION_SQL.updateKillSwitch).run(
        snapshot.state,
        snapshot.stateVersion,
        encodeKillSwitch(snapshot),
        snapshot.killSwitchId,
        expectedStateVersion,
      )
      if (result.changes !== 1) return optimisticFailure()
      this.recordAggregate(
        'KILL_SWITCH',
        snapshot.killSwitchId,
        portfolioId,
        snapshot.stateVersion,
        'SAVE',
      )
      return success(undefined)
    } catch {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
  }
}

export class SqliteFillFactRepository
  extends TransactionRepository
  implements FillFactRepository {
  public insert(fill: NormalizedFill): PersistenceResult<void> {
    if (!this.accessible()) return unavailable()
    const encoded = encodeExecutionFill(fill)
    const existing = this.payload(EXECUTION_SQL.selectFill, fill.fillId)
    if (existing !== undefined) {
      return existing.canonical_payload === encoded
        ? success(undefined)
        : failure(persistenceFailure('PERSISTENCE_DUPLICATE'))
    }
    try {
      this.database.prepare(EXECUTION_SQL.insertFill).run(
        fill.fillId,
        fill.orderId,
        fill.executionRunId,
        fill.portfolioId,
        fill.instrumentId,
        fill.side,
        fill.quantity.shares.toString(10),
        fill.price.minorUnits.toString(10),
        fill.contentHash,
        fill.tradeTime,
        encoded,
      )
      this.recordFact('FILL', fill.fillId, fill.portfolioId)
      return success(undefined)
    } catch {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
  }

  public getById(fillId: FillId): PersistenceResult<NormalizedFill | undefined> {
    if (!this.accessible()) return unavailable()
    const row = this.payload(EXECUTION_SQL.selectFill, fillId)
    return row === undefined ? success(undefined) : decodeExecutionFill(row.canonical_payload)
  }
}

export class SqliteCancellationFactRepository
  extends TransactionRepository
  implements CancellationFactRepository {
  private portfolioForOrder(orderId: OrderId): string | undefined {
    const row = this.database.prepare(EXECUTION_SQL.selectPortfolioByOrder).get(orderId) as
      | { portfolio_id: string }
      | undefined
    return row?.portfolio_id
  }

  public insertRequest(record: CancellationAttemptRecord): PersistenceResult<void> {
    if (!this.accessible()) return unavailable()
    const encoded = encodeCancellationRequest(record)
    const existing = this.payload(EXECUTION_SQL.selectCancellationRequest, record.cancellationId)
    if (existing !== undefined) {
      return existing.canonical_payload === encoded
        ? success(undefined)
        : failure(persistenceFailure('PERSISTENCE_DUPLICATE'))
    }
    const portfolioId = this.portfolioForOrder(record.orderId)
    if (portfolioId === undefined) {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
    try {
      this.database.prepare(EXECUTION_SQL.insertCancellationRequest).run(
        record.cancellationId,
        record.orderId,
        portfolioId,
        record.idempotencyKey,
        record.requestedAt,
        encoded,
      )
      this.recordFact('CANCELLATION_REQUEST', record.cancellationId, portfolioId)
      return success(undefined)
    } catch {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
  }

  public getRequestById(
    cancellationId: CancellationId,
  ): PersistenceResult<CancellationAttemptRecord | undefined> {
    if (!this.accessible()) return unavailable()
    const row = this.payload(EXECUTION_SQL.selectCancellationRequest, cancellationId)
    return row === undefined ? success(undefined) : decodeCancellationRequest(row.canonical_payload)
  }

  public findRequestByOrderAndIdempotencyKey(
    orderId: OrderId,
    idempotencyKey: CancellationAttemptRecord['idempotencyKey'],
  ): PersistenceResult<CancellationAttemptRecord | undefined> {
    if (!this.accessible()) return unavailable()
    const row = this.payload(EXECUTION_SQL.selectCancellationByIdempotency, orderId, idempotencyKey)
    return row === undefined ? success(undefined) : decodeCancellationRequest(row.canonical_payload)
  }

  public insertOutcome(record: CancellationOutcomeRecord): PersistenceResult<void> {
    if (!this.accessible()) return unavailable()
    const encoded = encodeCancellationOutcome(record)
    const existing = this.payload(EXECUTION_SQL.selectCancellationOutcome, record.cancellationId)
    if (existing !== undefined) {
      return existing.canonical_payload === encoded
        ? success(undefined)
        : failure(persistenceFailure('PERSISTENCE_DUPLICATE'))
    }
    const request = this.database.prepare(`
      SELECT portfolio_id FROM execution_cancellation_requests WHERE cancellation_id = ?
    `).get(record.cancellationId) as { portfolio_id: string } | undefined
    if (request === undefined) {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
    try {
      this.database.prepare(EXECUTION_SQL.insertCancellationOutcome).run(
        record.cancellationId,
        record.outcome,
        record.completedAt,
        encoded,
      )
      this.recordFact('CANCELLATION_OUTCOME', record.cancellationId, request.portfolio_id)
      return success(undefined)
    } catch {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
  }

  public getOutcomeById(
    cancellationId: CancellationId,
  ): PersistenceResult<CancellationOutcomeRecord | undefined> {
    if (!this.accessible()) return unavailable()
    const row = this.payload(EXECUTION_SQL.selectCancellationOutcome, cancellationId)
    return row === undefined ? success(undefined) : decodeCancellationOutcome(row.canonical_payload)
  }
}

export class SqliteResidualWorkRepository
  extends TransactionRepository
  implements ResidualWorkRepository {
  public insert(work: ResidualWork): PersistenceResult<void> {
    if (!this.accessible()) return unavailable()
    const encoded = encodeResidualWork(work)
    const existing = this.payload(EXECUTION_SQL.selectResidualWork, work.residualWorkId)
    if (existing !== undefined) {
      return existing.canonical_payload === encoded
        ? success(undefined)
        : failure(persistenceFailure('PERSISTENCE_DUPLICATE'))
    }
    const row = this.database.prepare(EXECUTION_SQL.selectPortfolioByOrder).get(work.orderId) as
      | { portfolio_id: string }
      | undefined
    if (row === undefined) return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    try {
      this.database.prepare(EXECUTION_SQL.insertResidualWork).run(
        work.residualWorkId,
        work.executionRunId,
        work.orderId,
        row.portfolio_id,
        work.remainingQuantity.shares.toString(10),
        work.reason,
        work.createdAt,
        encoded,
      )
      this.recordFact('RESIDUAL_WORK', work.residualWorkId, row.portfolio_id)
      return success(undefined)
    } catch {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
  }

  public getById(residualWorkId: ResidualWorkId): PersistenceResult<ResidualWork | undefined> {
    if (!this.accessible()) return unavailable()
    const row = this.payload(EXECUTION_SQL.selectResidualWork, residualWorkId)
    return row === undefined ? success(undefined) : decodeResidualWork(row.canonical_payload)
  }
}

export class SqliteAdjustmentProposalRepository
  extends TransactionRepository
  implements AdjustmentProposalRepository {
  private portfolioForRun(reconciliationRunId: ReconciliationRunId): string | undefined {
    const row = this.database.prepare(EXECUTION_SQL.selectPortfolioByReconciliationRun).get(
      reconciliationRunId,
    ) as { portfolio_id: string } | undefined
    return row?.portfolio_id
  }

  public insert(proposal: AdjustmentProposal): PersistenceResult<void> {
    if (!this.accessible()) return unavailable()
    const encoded = encodeAdjustmentProposal(proposal)
    const existing = this.payload(
      EXECUTION_SQL.selectAdjustmentProposal,
      proposal.adjustmentProposalId,
    )
    if (existing !== undefined) {
      return existing.canonical_payload === encoded
        ? success(undefined)
        : failure(persistenceFailure('PERSISTENCE_DUPLICATE'))
    }
    const portfolioId = this.portfolioForRun(proposal.reconciliationRunId)
    if (portfolioId === undefined) {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
    try {
      this.database.prepare(EXECUTION_SQL.insertAdjustmentProposal).run(
        proposal.adjustmentProposalId,
        proposal.reconciliationRunId,
        portfolioId,
        proposal.state,
        proposal.contentHash,
        proposal.stateVersion,
        encoded,
      )
      this.recordAggregate(
        'ADJUSTMENT_PROPOSAL',
        proposal.adjustmentProposalId,
        portfolioId,
        proposal.stateVersion,
        'INSERT',
      )
      return success(undefined)
    } catch {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
  }

  public getById(
    adjustmentProposalId: AdjustmentProposalId,
  ): PersistenceResult<AdjustmentProposal | undefined> {
    if (!this.accessible()) return unavailable()
    const row = this.payload(EXECUTION_SQL.selectAdjustmentProposal, adjustmentProposalId)
    return row === undefined ? success(undefined) : decodeAdjustmentProposal(row.canonical_payload)
  }

  public save(
    proposal: AdjustmentProposal,
    expectedStateVersion: number,
  ): PersistenceResult<void> {
    if (!this.accessible()) return unavailable()
    if (proposal.stateVersion !== expectedStateVersion + 1) return optimisticFailure()
    const portfolioId = this.portfolioForRun(proposal.reconciliationRunId)
    if (portfolioId === undefined) {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
    try {
      const result = this.database.prepare(EXECUTION_SQL.updateAdjustmentProposal).run(
        proposal.state,
        proposal.stateVersion,
        encodeAdjustmentProposal(proposal),
        proposal.adjustmentProposalId,
        expectedStateVersion,
      )
      if (result.changes !== 1) return optimisticFailure()
      this.recordAggregate(
        'ADJUSTMENT_PROPOSAL',
        proposal.adjustmentProposalId,
        portfolioId,
        proposal.stateVersion,
        'SAVE',
      )
      return success(undefined)
    } catch {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
  }
}
