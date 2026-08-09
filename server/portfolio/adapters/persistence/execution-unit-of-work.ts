import type Database from 'better-sqlite3'

import { isKnownEvidenceKind, type ExecutionEvidencePayload } from '../../domain/execution/evidence.ts'
import { failure, success, type AnyDomainFailure, type DomainResult } from '../../domain/errors/result.ts'
import type { PortfolioId } from '../../domain/shared/identifiers.ts'
import type { PortfolioStateVersion } from '../../domain/shared/state-version.ts'
import type {
  CommittedExecutionResult,
  ExecutionTransaction,
  ExecutionUnitOfWork,
  KillSwitchResetEligibilityToken,
} from '../../ports/execution/execution-unit-of-work.ts'
import { persistenceFailure } from '../../infrastructure/persistence/failures.ts'
import {
  appendExecutionDomainEvents,
  createExecutionDomainEvents,
} from './execution-event-ledger.ts'
import {
  SqliteAdjustmentProposalRepository,
  SqliteCancellationFactRepository,
  SqliteExecutionApprovalRepository,
  SqliteExecutionOrderRepository,
  SqliteExecutionRunRepository,
  SqliteFillFactRepository,
  SqliteKillSwitchRepository,
  SqliteReconciliationRunRepository,
  SqliteReconciliationSnapshotRepository,
  SqliteResidualWorkRepository,
} from './execution-repositories.ts'
import { EXECUTION_SQL } from './execution-statement-catalog.ts'
import { SqlitePortfolioRepository } from './portfolio-repository.ts'
import {
  transactionMutationIdentity,
  type TransactionMutation,
} from './unit-of-work.ts'

class SqliteExecutionTransaction implements ExecutionTransaction {
  private active = true
  private duplicateMutation = false
  private readonly mutations: TransactionMutation[] = []
  private readonly mutationIdentities = new Set<string>()
  private readonly evidence: ExecutionEvidencePayload[] = []
  private readonly database: Database.Database

  public readonly portfolioState: ExecutionTransaction['portfolioState']
  public readonly portfolioAccounting: ExecutionTransaction['portfolioAccounting']
  public readonly killSwitchResetEligibility:
    ExecutionTransaction['killSwitchResetEligibility']
  public readonly approvals: SqliteExecutionApprovalRepository
  public readonly runs: SqliteExecutionRunRepository
  public readonly orders: SqliteExecutionOrderRepository
  public readonly reconciliationRuns: SqliteReconciliationRunRepository
  public readonly reconciliationSnapshots: SqliteReconciliationSnapshotRepository
  public readonly killSwitches: SqliteKillSwitchRepository
  public readonly fills: SqliteFillFactRepository
  public readonly cancellations: SqliteCancellationFactRepository
  public readonly residuals: SqliteResidualWorkRepository
  public readonly adjustmentProposals: SqliteAdjustmentProposalRepository

  public constructor(database: Database.Database, now: () => string) {
    this.database = database
    const canAccess = () => this.active
    const recordMutation = (mutation: TransactionMutation): void => {
      const identity = transactionMutationIdentity(mutation)
      if (this.mutationIdentities.has(identity)) {
        this.duplicateMutation = true
        return
      }
      this.mutationIdentities.add(identity)
      this.mutations.push(Object.freeze({ ...mutation }))
    }
    const portfolioRepository = new SqlitePortfolioRepository(
      database,
      true,
      canAccess,
      now,
      (portfolio, kind) => recordMutation(Object.freeze({
        category: 'PORTFOLIO',
        kind,
        portfolioId: portfolio.portfolioId,
        stateVersion: portfolio.stateVersion,
      })),
    )
    this.portfolioState = Object.freeze({
      assertCurrent: (
        portfolioId: PortfolioId,
        expectedStateVersion: PortfolioStateVersion,
        expectedStatus: 'ACTIVE',
      ): DomainResult<void, AnyDomainFailure> => {
        if (!this.active) {
          return failure(persistenceFailure('PERSISTENCE_CAPABILITY_LEAK'))
        }
        const row = database.prepare(EXECUTION_SQL.selectPortfolioStatusVersion).get(
          portfolioId,
        ) as { status: string; state_version: number } | undefined
        return row?.status === expectedStatus && row.state_version === expectedStateVersion
          ? success(undefined)
          : failure(persistenceFailure('PERSISTENCE_VERSION_CONFLICT', {
              retryability: 'AFTER_STATE_REFRESH',
            }))
      },
    })
    this.portfolioAccounting = Object.freeze({
      getById: portfolioRepository.getById.bind(portfolioRepository),
      save: portfolioRepository.save.bind(portfolioRepository),
    })
    this.killSwitchResetEligibility = Object.freeze({
      assertCurrent: (
        token: KillSwitchResetEligibilityToken,
      ): DomainResult<void, AnyDomainFailure> => this.assertResetEligibility(token),
    })

    const argumentsForRepository = [database, canAccess, recordMutation] as const
    this.approvals = new SqliteExecutionApprovalRepository(...argumentsForRepository)
    this.runs = new SqliteExecutionRunRepository(...argumentsForRepository)
    this.orders = new SqliteExecutionOrderRepository(...argumentsForRepository)
    this.reconciliationRuns = new SqliteReconciliationRunRepository(...argumentsForRepository)
    this.reconciliationSnapshots =
      new SqliteReconciliationSnapshotRepository(...argumentsForRepository)
    this.killSwitches = new SqliteKillSwitchRepository(...argumentsForRepository)
    this.fills = new SqliteFillFactRepository(...argumentsForRepository)
    this.cancellations = new SqliteCancellationFactRepository(...argumentsForRepository)
    this.residuals = new SqliteResidualWorkRepository(...argumentsForRepository)
    this.adjustmentProposals =
      new SqliteAdjustmentProposalRepository(...argumentsForRepository)
  }

  private assertResetEligibility(
    token: KillSwitchResetEligibilityToken,
  ): DomainResult<void, AnyDomainFailure> {
    if (!this.active) {
      return failure(persistenceFailure('PERSISTENCE_CAPABILITY_LEAK'))
    }
    const switchRow = this.database.prepare(`
      SELECT state_version FROM execution_kill_switches WHERE kill_switch_id = ?
    `).get(token.killSwitchId) as { state_version: number } | undefined
    if (switchRow?.state_version !== token.killSwitchStateVersion) {
      return failure(persistenceFailure('PERSISTENCE_VERSION_CONFLICT', {
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
    for (const expected of token.affectedPortfolioVersions) {
      const row = this.database.prepare(EXECUTION_SQL.selectPortfolioStatusVersion).get(
        expected.portfolioId,
      ) as { status: string; state_version: number } | undefined
      if (row?.status !== 'ACTIVE' || row.state_version !== expected.stateVersion) {
        return failure(persistenceFailure('PERSISTENCE_VERSION_CONFLICT', {
          retryability: 'AFTER_STATE_REFRESH',
        }))
      }
    }
    for (const snapshotId of token.reconciliationSnapshotIds) {
      const row = this.database.prepare(
        'SELECT 1 AS present FROM reconciliation_snapshots WHERE snapshot_id = ?',
      ).get(snapshotId)
      if (row === undefined) {
        return failure(persistenceFailure('PERSISTENCE_VERSION_CONFLICT', {
          retryability: 'AFTER_STATE_REFRESH',
        }))
      }
    }
    return success(undefined)
  }

  public stageEvidence(
    payloads: readonly ExecutionEvidencePayload[],
  ): DomainResult<void, AnyDomainFailure> {
    if (!this.active) {
      return failure(persistenceFailure('PERSISTENCE_CAPABILITY_LEAK'))
    }
    if (payloads.some((payload) => !isKnownEvidenceKind(payload.kind))) {
      return failure(persistenceFailure('PERSISTED_EVENT_MISMATCH'))
    }
    this.evidence.push(...payloads)
    return success(undefined)
  }

  public takeMutations(): readonly TransactionMutation[] {
    return Object.freeze([...this.mutations])
  }

  public takeEvidence(): readonly ExecutionEvidencePayload[] {
    return Object.freeze([...this.evidence])
  }

  public hasDuplicateMutation(): boolean {
    return this.duplicateMutation
  }

  public close(): void {
    this.active = false
  }
}

export class SqliteExecutionUnitOfWork implements ExecutionUnitOfWork {
  private readonly database: Database.Database
  private readonly now: () => string
  private readonly canAccess: () => boolean

  public constructor(
    database: Database.Database,
    now: () => string,
    canAccess: () => boolean = () => true,
  ) {
    this.database = database
    this.now = now
    this.canAccess = canAccess
  }

  public execute<T>(
    work: (transaction: ExecutionTransaction) => DomainResult<T, AnyDomainFailure>,
  ): DomainResult<CommittedExecutionResult<T>, AnyDomainFailure> {
    if (!this.canAccess()) {
      return failure(persistenceFailure('PERSISTENCE_NOT_OPEN'))
    }
    if (this.database.inTransaction) {
      return failure(persistenceFailure('NESTED_TRANSACTION_FORBIDDEN'))
    }
    try {
      this.database.exec('BEGIN IMMEDIATE')
    } catch {
      return failure(persistenceFailure('DATABASE_BUSY', {
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }

    const transaction = new SqliteExecutionTransaction(this.database, this.now)
    try {
      const result = work(transaction)
      if (typeof result === 'object' && result !== null && 'then' in result) {
        throw new Error('ASYNC_TRANSACTION_CALLBACK')
      }
      if (!result.ok) {
        this.database.exec('ROLLBACK')
        transaction.close()
        return result
      }
      if (transaction.hasDuplicateMutation()) {
        this.database.exec('ROLLBACK')
        transaction.close()
        return failure(persistenceFailure('PERSISTED_EVENT_MISMATCH'))
      }
      const evidence = transaction.takeEvidence()
      const events = createExecutionDomainEvents(
        transaction.takeMutations(),
        evidence,
      )
      if (!events.ok) {
        this.database.exec('ROLLBACK')
        transaction.close()
        return events
      }
      const appended = appendExecutionDomainEvents(
        this.database,
        events.value,
        this.now(),
      )
      if (!appended.ok) {
        this.database.exec('ROLLBACK')
        transaction.close()
        return appended
      }
      this.database.exec('COMMIT')
      transaction.close()
      return success(Object.freeze({
        value: result.value,
        postCommitEvidence: evidence,
      }))
    } catch (error) {
      if (this.database.inTransaction) this.database.exec('ROLLBACK')
      transaction.close()
      return failure(persistenceFailure(
        error instanceof Error && error.message === 'ASYNC_TRANSACTION_CALLBACK'
          ? 'ASYNC_TRANSACTION_FORBIDDEN'
          : 'PERSISTENCE_ATOMICITY_FAILED',
      ))
    }
  }
}
