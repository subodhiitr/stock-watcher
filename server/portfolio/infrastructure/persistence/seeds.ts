import type Database from 'better-sqlite3'

import { createHash } from 'node:crypto'

import { failure, success } from '../../domain/errors/result.ts'
import {
  parseActorId,
  parseCausationId,
  parseCommandId,
  parseCorrelationId,
  parseEventId,
  parseEvidenceId,
  parsePortfolioId,
  parseStrategyAssignmentId,
  parseStrategyId,
  parseStrategyVersionId,
} from '../../domain/shared/identifiers.ts'
import { createMoney } from '../../domain/shared/money.ts'
import { NO_PORTFOLIO_STATE_VERSION } from '../../domain/shared/state-version.ts'
import { parseInstant, type Instant } from '../../domain/shared/time.ts'
import { createWeight } from '../../domain/shared/weight.ts'
import { createStrategyEligibilityEvidence, parseIntegrityHash } from '../../domain/portfolio/evidence.ts'
import { Portfolio } from '../../domain/portfolio/portfolio.ts'
import { createSingleStrategyAllocation } from '../../domain/portfolio/strategy-allocation.ts'
import {
  persistenceFailure,
  type PersistenceResult,
} from './failures.ts'
import { canonicalJson } from '../../adapters/persistence/codecs.ts'
import { SqlitePortfolioUnitOfWork } from '../../adapters/persistence/unit-of-work.ts'

const SEED_VERSION = 1
const PAPER_PORTFOLIO_SEED_KEY = 'seed:portfolio:paper-default'

const STRATEGIES = Object.freeze([
  {
    key: 'short-horizon-momentum',
    strategyId: 'strategy:short-horizon-momentum',
    versionId: 'strategy-version:short-horizon-momentum:v1',
    name: 'Short Horizon Momentum',
    horizon: 'SHORT',
    payload: { horizon: 'SHORT', rebalanceCadence: 'DAILY', signal: 'MOMENTUM' },
  },
  {
    key: 'adaptive-momentum-quality',
    strategyId: 'strategy:adaptive-momentum-quality',
    versionId: 'strategy-version:adaptive-momentum-quality:v1',
    name: 'Adaptive Momentum Quality',
    horizon: 'MEDIUM',
    payload: { horizon: 'MEDIUM', rebalanceCadence: 'WEEKLY', signals: ['MOMENTUM', 'QUALITY'] },
  },
  {
    key: 'long-horizon-quality',
    strategyId: 'strategy:long-horizon-quality',
    versionId: 'strategy-version:long-horizon-quality:v1',
    name: 'Long Horizon Quality',
    horizon: 'LONG',
    payload: { horizon: 'LONG', rebalanceCadence: 'MONTHLY', signal: 'QUALITY' },
  },
] as const)

function expectedSeedIdentities(): ReadonlyMap<string, string> {
  const identities = new Map<string, string>([
    [PAPER_PORTFOLIO_SEED_KEY, 'portfolio:paper-default'],
  ])
  for (const strategy of STRATEGIES) {
    identities.set(`seed:strategy:${strategy.key}`, strategy.strategyId)
    identities.set(
      `seed:strategy-version:${strategy.key}:v1`,
      strategy.versionId,
    )
  }
  return identities
}

function value<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) throw new Error('INVALID_SEED_VALUE')
  return result.value
}

function insertSeedRegistry(
  database: Database.Database,
  seedKey: string,
  entityType: string,
  entityId: string,
  createdAt: Instant,
): void {
  database.prepare(`
    INSERT INTO seed_registry (
      seed_key, entity_type, entity_id, seed_version, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(seedKey, entityType, entityId, SEED_VERSION, createdAt)
}

export function seedPortfolioDatabase(
  database: Database.Database,
  now: Instant,
  defaultStartingCashMinorUnits: bigint,
): PersistenceResult<void> {
  const expectedSeeds = expectedSeedIdentities()
  const existingSeeds = database.prepare(`
    SELECT seed_key, entity_id, seed_version
    FROM seed_registry
    WHERE seed_key LIKE 'seed:strategy:%'
       OR seed_key LIKE 'seed:strategy-version:%'
       OR seed_key = ?
  `).all(PAPER_PORTFOLIO_SEED_KEY) as readonly {
    seed_key: string
    entity_id: string
    seed_version: number
  }[]
  if (existingSeeds.length > 0) {
    if (
      existingSeeds.length !== expectedSeeds.size
      || existingSeeds.some((row) =>
        expectedSeeds.get(row.seed_key) !== row.entity_id
        || row.seed_version !== SEED_VERSION)
    ) {
      return failure(persistenceFailure('SEED_IDENTITY_CONFLICT'))
    }
    return success(undefined)
  }

  const unitOfWork = new SqlitePortfolioUnitOfWork(database, () => now)
  const result = unitOfWork.execute((transaction) => {
    try {
      for (const strategy of STRATEGIES) {
        const definitionSeed = `seed:strategy:${strategy.key}`
        const versionSeed = `seed:strategy-version:${strategy.key}:v1`
        insertSeedRegistry(
          database,
          definitionSeed,
          'STRATEGY_DEFINITION',
          strategy.strategyId,
          now,
        )
        database.prepare(`
          INSERT INTO strategy_definitions (
            strategy_id, strategy_key, display_name, horizon, seed_key
          ) VALUES (?, ?, ?, ?, ?)
        `).run(
          value(parseStrategyId(strategy.strategyId)),
          strategy.key,
          strategy.name,
          strategy.horizon,
          definitionSeed,
        )

        const payload = canonicalJson(strategy.payload)
        insertSeedRegistry(
          database,
          versionSeed,
          'STRATEGY_VERSION',
          strategy.versionId,
          now,
        )
        database.prepare(`
          INSERT INTO strategy_versions (
            strategy_version_id, strategy_id, semantic_version,
            canonical_payload, payload_sha256, status, created_at, seed_key
          ) VALUES (?, ?, '1.0.0', ?, ?, 'SEEDED', ?, ?)
        `).run(
          value(parseStrategyVersionId(strategy.versionId)),
          value(parseStrategyId(strategy.strategyId)),
          payload,
          createHash('sha256').update(payload).digest('hex'),
          now,
          versionSeed,
        )
      }

      const portfolioId = value(parsePortfolioId('portfolio:paper-default'))
      const strategyVersionId = value(
        parseStrategyVersionId('strategy-version:adaptive-momentum-quality:v1'),
      )
      const issuedAt = value(parseInstant('2020-01-01T00:00:00.000Z'))
      const expiresAt = value(parseInstant('9999-12-31T23:59:59.999Z'))
      const evidence = value(createStrategyEligibilityEvidence({
        evidenceId: value(parseEvidenceId('evidence:seed-paper-strategy')),
        portfolioId,
        strategyVersionId,
        issuerId: value(parseActorId('actor:system-seed')),
        issuedAt,
        expiresAt,
        evidenceHash: value(parseIntegrityHash(
          createHash('sha256').update('seed-paper-strategy').digest('hex'),
        )),
      }))
      const allocationPolicy = value(createSingleStrategyAllocation(portfolioId, {
        assignmentId: value(parseStrategyAssignmentId('assignment:paper-default')),
        strategyVersionId,
        weight: value(createWeight(1_000_000n)),
        effectiveAt: now,
        evidenceReference: evidence,
      }))
      const transition = Portfolio.create({
        portfolioId,
        displayName: 'Paper Portfolio',
        startingCash: value(createMoney(defaultStartingCashMinorUnits, 'INR')),
        mode: 'PAPER',
        modeEvidence: [],
        allocationPolicy,
        nameUniquenessVerified: true,
        context: {
          commandId: value(parseCommandId('command:seed-paper-default')),
          actorId: value(parseActorId('actor:system-seed')),
          correlationId: value(parseCorrelationId('correlation:seed-paper-default')),
          causationId: value(parseCausationId('causation:seed-paper-default')),
          effectiveAt: now,
          expectedStateVersion: NO_PORTFOLIO_STATE_VERSION,
        },
        eventId: value(parseEventId('event:seed-paper-created')),
      })
      if (!transition.ok) return transition

      insertSeedRegistry(
        database,
        PAPER_PORTFOLIO_SEED_KEY,
        'PORTFOLIO',
        portfolioId,
        now,
      )
      const inserted = transaction.portfolios.insert(transition.value.state)
      if (!inserted.ok) return inserted
      database.prepare(
        'UPDATE portfolios SET seed_key = ? WHERE portfolio_id = ?',
      ).run(PAPER_PORTFOLIO_SEED_KEY, portfolioId)
      const appended = transaction.appendDomainEvents(transition.value.events)
      if (!appended.ok) return appended
      return success(undefined)
    } catch {
      return failure(persistenceFailure('PAPER_PORTFOLIO_SEED_FAILED'))
    }
  })
  return result.ok
    ? success(undefined)
    : failure(persistenceFailure('PAPER_PORTFOLIO_SEED_FAILED', {
        context: { causeCode: result.error.code },
      }))
}
