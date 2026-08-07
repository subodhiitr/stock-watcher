import type Database from 'better-sqlite3'

import { failure, success, type AnyDomainFailure, type DomainResult } from '../../domain/errors/result.ts'
import type { PortfolioDomainEvent } from '../../domain/events/domain-events.ts'
import type {
  CommittedDomainResult,
  PortfolioTransaction,
  PortfolioUnitOfWork,
} from '../../ports/index.ts'
import {
  persistenceFailure,
} from '../../infrastructure/persistence/failures.ts'
import { appendDomainEvents } from './event-ledger.ts'
import { SqlitePortfolioRepository } from './portfolio-repository.ts'

export type PortfolioMutation = Readonly<{
  category: 'PORTFOLIO'
  kind: 'INSERT' | 'SAVE'
  portfolioId: string
  stateVersion: number
}>

export type ExecutionAggregateKind =
  | 'APPROVAL'
  | 'EXECUTION_RUN'
  | 'EXECUTION_ORDER'
  | 'RECONCILIATION_RUN'
  | 'KILL_SWITCH'
  | 'ADJUSTMENT_PROPOSAL'

export type ExecutionAggregateMutation = Readonly<{
  category: 'EXECUTION_AGGREGATE'
  kind: 'INSERT' | 'SAVE'
  aggregateKind: ExecutionAggregateKind
  aggregateId: string
  portfolioId?: string
  stateVersion: number
}>

export type ExecutionFactKind =
  | 'RECONCILIATION_SNAPSHOT'
  | 'FILL'
  | 'CANCELLATION_REQUEST'
  | 'CANCELLATION_OUTCOME'
  | 'RESIDUAL_WORK'

export type ExecutionFactInsertion = Readonly<{
  category: 'EXECUTION_FACT'
  factKind: ExecutionFactKind
  factId: string
  portfolioId: string
}>

export type TransactionMutation =
  | PortfolioMutation
  | ExecutionAggregateMutation
  | ExecutionFactInsertion

export function transactionMutationIdentity(mutation: TransactionMutation): string {
  switch (mutation.category) {
    case 'PORTFOLIO':
      return `${mutation.category}:${mutation.kind}:${mutation.portfolioId}:${mutation.stateVersion}`
    case 'EXECUTION_AGGREGATE':
      return `${mutation.category}:${mutation.kind}:${mutation.aggregateKind}:${mutation.aggregateId}:${mutation.stateVersion}`
    case 'EXECUTION_FACT':
      return `${mutation.category}:${mutation.factKind}:${mutation.factId}`
  }
}

class SqlitePortfolioTransaction
  implements PortfolioTransaction {
  private readonly stagedEvents: PortfolioDomainEvent[] = []
  private readonly mutations: TransactionMutation[] = []
  private readonly mutationIdentities = new Set<string>()
  private duplicateMutation = false
  private active = true
  public readonly portfolios: SqlitePortfolioRepository

  public constructor(database: Database.Database, now: () => string) {
    this.portfolios = new SqlitePortfolioRepository(
      database,
      true,
      () => this.active,
      now,
      (portfolio, kind) => {
        this.recordMutation({
          category: 'PORTFOLIO',
          portfolioId: portfolio.portfolioId,
          stateVersion: portfolio.stateVersion,
          kind,
        })
      },
    )
  }

  public appendDomainEvents(
    events: readonly PortfolioDomainEvent[],
  ): DomainResult<void, AnyDomainFailure> {
    if (!this.active) {
      return failure(persistenceFailure('PERSISTENCE_CAPABILITY_LEAK'))
    }
    this.stagedEvents.push(...events)
    return success(undefined)
  }

  public takeEvents(): readonly PortfolioDomainEvent[] {
    return Object.freeze([...this.stagedEvents])
  }

  public recordMutation(mutation: TransactionMutation): void {
    const identity = transactionMutationIdentity(mutation)
    if (this.mutationIdentities.has(identity)) {
      this.duplicateMutation = true
      return
    }
    this.mutationIdentities.add(identity)
    this.mutations.push(Object.freeze({ ...mutation }))
  }

  public takeMutations(): readonly TransactionMutation[] {
    return Object.freeze([...this.mutations])
  }

  public stagedStateMatchesEvents(): boolean {
    if (this.duplicateMutation) return false
    if (this.mutations.length !== this.stagedEvents.length) return false
    const unmatched = [...this.stagedEvents]
    for (const mutation of this.mutations) {
      if (mutation.category !== 'PORTFOLIO') return false
      const index = unmatched.findIndex((event) =>
        event.portfolioId === mutation.portfolioId
        && event.stateVersion === mutation.stateVersion
        && (mutation.kind !== 'INSERT' || event.type === 'PortfolioCreated'))
      if (index < 0) return false
      unmatched.splice(index, 1)
    }
    return unmatched.length === 0
  }

  public close(): void {
    this.active = false
  }
}

export class SqlitePortfolioUnitOfWork
  implements PortfolioUnitOfWork {
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
    work: (transaction: PortfolioTransaction) => DomainResult<T, AnyDomainFailure>,
  ): DomainResult<CommittedDomainResult<T>, AnyDomainFailure> {
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

    const transaction = new SqlitePortfolioTransaction(this.database, this.now)
    try {
      const result = work(transaction)
      if (
        typeof result === 'object'
        && result !== null
        && 'then' in result
      ) {
        throw new Error('ASYNC_TRANSACTION_CALLBACK')
      }
      if (!result.ok) {
        this.database.exec('ROLLBACK')
        transaction.close()
        return result
      }
      if (!transaction.stagedStateMatchesEvents()) {
        this.database.exec('ROLLBACK')
        transaction.close()
        return failure(persistenceFailure('PERSISTED_EVENT_MISMATCH'))
      }

      const appended = appendDomainEvents(
        this.database,
        transaction.takeEvents(),
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
        postCommitEvents: transaction.takeEvents(),
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
