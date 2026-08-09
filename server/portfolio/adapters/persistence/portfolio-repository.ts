import type Database from 'better-sqlite3'

import { failure, success } from '../../domain/errors/result.ts'
import type { PortfolioRepository } from '../../ports/index.ts'
import type { Portfolio } from '../../domain/portfolio/portfolio.ts'
import {
  allocationPolicyIdentity,
} from '../../domain/portfolio/strategy-allocation.ts'
import type { PortfolioId } from '../../domain/shared/identifiers.ts'
import type { PortfolioStateVersion } from '../../domain/shared/state-version.ts'
import {
  persistenceFailure,
  type PersistenceResult,
} from '../../infrastructure/persistence/failures.ts'
import { encodeMoney } from './codecs.ts'
import {
  insertAllocation,
  loadPortfolio,
  replaceHoldings,
} from './snapshot-mapper.ts'
import { SQL } from './statement-catalog.ts'

export class SqlitePortfolioRepository implements PortfolioRepository {
  private readonly database: Database.Database
  private readonly writable: boolean
  private readonly canAccess: () => boolean
  private readonly now: () => string
  private readonly onMutation: (
    portfolio: Portfolio,
    kind: 'INSERT' | 'SAVE',
  ) => void

  public constructor(
    database: Database.Database,
    writable: boolean,
    canAccess: () => boolean = () => true,
    now: () => string = () => '',
    onMutation: (
      portfolio: Portfolio,
      kind: 'INSERT' | 'SAVE',
    ) => void = () => undefined,
  ) {
    this.database = database
    this.writable = writable
    this.canAccess = canAccess
    this.now = now
    this.onMutation = onMutation
  }

  public getById(portfolioId: PortfolioId): PersistenceResult<Portfolio | undefined> {
    if (!this.canAccess()) {
      return failure(persistenceFailure('PERSISTENCE_CAPABILITY_LEAK'))
    }
    return loadPortfolio(this.database, portfolioId)
  }

  public findByName(
    normalizedNameKey: string,
  ): PersistenceResult<Portfolio | undefined> {
    if (!this.canAccess()) {
      return failure(persistenceFailure('PERSISTENCE_CAPABILITY_LEAK'))
    }
    try {
      const row = this.database.prepare(`
        SELECT portfolio_id FROM portfolios WHERE normalized_name_key = ?
      `).get(
        normalizedNameKey,
      ) as { portfolio_id: PortfolioId } | undefined
      return row === undefined
        ? success(undefined)
        : loadPortfolio(this.database, row.portfolio_id)
    } catch {
      return failure(persistenceFailure('PORTFOLIO_REHYDRATION_FAILED'))
    }
  }

  public activeNameExists(normalizedNameKey: string): PersistenceResult<boolean> {
    if (!this.canAccess()) {
      return failure(persistenceFailure('PERSISTENCE_CAPABILITY_LEAK'))
    }
    try {
      const row = this.database.prepare(`
        SELECT 1 AS present
        FROM portfolios
        WHERE normalized_name_key = ? AND status = 'ACTIVE'
        LIMIT 1
      `).get(normalizedNameKey) as { present: number } | undefined
      return success(row?.present === 1)
    } catch {
      return failure(persistenceFailure('PORTFOLIO_REHYDRATION_FAILED'))
    }
  }

  public insert(portfolio: Portfolio): PersistenceResult<void> {
    if (!this.canAccess()) {
      return failure(persistenceFailure('PERSISTENCE_CAPABILITY_LEAK'))
    }
    if (!this.writable) return failure(persistenceFailure('PERSISTENCE_OWNER_REQUIRED'))
    if (portfolio.stateVersion !== 1) {
      return failure(persistenceFailure('INVALID_PORTFOLIO_INSERT'))
    }
    try {
      const snapshot = portfolio.snapshot()
      this.database.prepare(SQL.insertPortfolio).run(
        portfolio.portfolioId,
        snapshot.name.display,
        snapshot.name.uniquenessKey,
        snapshot.baseCurrency,
        snapshot.createdAt,
        portfolio.status,
        portfolio.mode,
        encodeMoney(portfolio.cash),
        portfolio.stateVersion,
        null,
        this.now(),
      )
      insertAllocation(this.database, portfolio)
      replaceHoldings(this.database, portfolio)
      this.onMutation(portfolio, 'INSERT')
      return success(undefined)
    } catch (error) {
      const code = error instanceof Error && error.message.includes('UNIQUE')
        ? 'PERSISTENCE_DUPLICATE'
        : 'PERSISTENCE_ATOMICITY_FAILED'
      return failure(persistenceFailure(code))
    }
  }

  public save(
    portfolio: Portfolio,
    expectedVersion: PortfolioStateVersion,
  ): PersistenceResult<void> {
    if (!this.canAccess()) {
      return failure(persistenceFailure('PERSISTENCE_CAPABILITY_LEAK'))
    }
    if (!this.writable) return failure(persistenceFailure('PERSISTENCE_OWNER_REQUIRED'))
    if (portfolio.stateVersion !== expectedVersion + 1) {
      return failure(persistenceFailure('PERSISTENCE_VERSION_CONFLICT'))
    }
    try {
      const snapshot = portfolio.snapshot()
      const result = this.database.prepare(SQL.updatePortfolio).run(
        snapshot.name.display,
        snapshot.name.uniquenessKey,
        portfolio.status,
        portfolio.mode,
        encodeMoney(portfolio.cash),
        portfolio.stateVersion,
        this.now(),
        portfolio.portfolioId,
        expectedVersion,
      )
      if (result.changes !== 1) {
        const exists = this.database.prepare(SQL.selectPortfolioVersion).get(
          portfolio.portfolioId,
        )
        return failure(persistenceFailure(
          exists === undefined
            ? 'PORTFOLIO_NOT_FOUND'
            : 'PERSISTENCE_VERSION_CONFLICT',
        ))
      }

      const current = this.database.prepare(SQL.selectCurrentAllocation).get(
        portfolio.portfolioId,
      ) as { policy_identity: string } | undefined
      const nextIdentity = allocationPolicyIdentity(portfolio.allocationPolicy)
      if (current?.policy_identity !== nextIdentity) {
        const close = this.database.prepare(SQL.closeCurrentAllocation).run(
          portfolio.stateVersion,
          portfolio.portfolioId,
        )
        if (close.changes !== 1) {
          return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
        }
        insertAllocation(this.database, portfolio)
      }
      replaceHoldings(this.database, portfolio)
      this.onMutation(portfolio, 'SAVE')
      return success(undefined)
    } catch {
      return failure(persistenceFailure('PERSISTENCE_ATOMICITY_FAILED'))
    }
  }
}
