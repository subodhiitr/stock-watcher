import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

import {
  Portfolio,
  TemporaryTestEncryptionAttestation,
  createMoney,
  createPortfolioStateVersion,
  createSingleStrategyAllocation,
  createStrategyEligibilityEvidence,
  createWeight,
  openPortfolioDatabase,
  parseActorId,
  parseCausationId,
  parseCommandId,
  parseCorrelationId,
  parseEventId,
  parseEvidenceId,
  parseIntegrityHash,
  parsePortfolioId,
  parseStrategyAssignmentId,
  parseStrategyVersionId,
  parseInstant,
  type AnyDomainFailure,
  type DomainResult,
  type Instant,
  type PortfolioDatabaseConfiguration,
} from '../../../server/portfolio/index.ts'

export const TEST_INSTANT = must(parseInstant('2026-01-01T00:00:00.000Z'))
const ISSUED_AT = must(parseInstant('2020-01-01T00:00:00.000Z'))
const EXPIRES_AT = must(parseInstant('9999-12-31T23:59:59.999Z'))

export function must<T, E extends AnyDomainFailure>(result: DomainResult<T, E>): T {
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

export function temporaryConfiguration(
  databasePath: string = ':memory:',
  now: Instant = TEST_INSTANT,
): PortfolioDatabaseConfiguration {
  return Object.freeze({
    databasePath,
    mode: 'TEMPORARY_TEST',
    protectedLegacyPaths: Object.freeze([]),
    busyTimeoutMs: 5_000,
    encryptionAttestation: new TemporaryTestEncryptionAttestation(now),
    now: () => now,
    defaultStartingCashMinorUnits: 100_000_000n,
  })
}

export function openTestOwner(databasePath: string = ':memory:') {
  return must(openPortfolioDatabase(temporaryConfiguration(databasePath)))
}

export function createTemporaryDatabasePath(): Readonly<{
  directory: string
  databasePath: string
}> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-watcher-portfolio-'))
  return Object.freeze({
    directory,
    databasePath: path.join(directory, 'portfolio-test.db'),
  })
}

export function removeTemporaryDirectory(directory: string): void {
  fs.rmSync(directory, { recursive: true, force: true })
}

export function makePortfolio(
  token: string,
  displayName: string,
  strategyVersion = 'strategy-version:adaptive-momentum-quality:v1',
) {
  const portfolioId = must(parsePortfolioId(`portfolio:test:${token}`))
  const strategyVersionId = must(parseStrategyVersionId(strategyVersion))
  const evidence = must(createStrategyEligibilityEvidence({
    evidenceId: must(parseEvidenceId(`evidence:test:${token}`)),
    portfolioId,
    strategyVersionId,
    issuerId: must(parseActorId('actor:test-suite')),
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    evidenceHash: must(parseIntegrityHash('a'.repeat(64))),
  }))
  const allocationPolicy = must(createSingleStrategyAllocation(portfolioId, {
    assignmentId: must(parseStrategyAssignmentId(`assignment:test:${token}`)),
    strategyVersionId,
    weight: must(createWeight(1_000_000n)),
    effectiveAt: TEST_INSTANT,
    evidenceReference: evidence,
  }))
  return must(Portfolio.create({
    portfolioId,
    displayName,
    startingCash: must(createMoney(100_000_000n)),
    mode: 'PAPER',
    modeEvidence: [],
    allocationPolicy,
    nameUniquenessVerified: true,
    context: {
      commandId: must(parseCommandId(`command:create:${token}`)),
      actorId: must(parseActorId('actor:test-suite')),
      correlationId: must(parseCorrelationId(`correlation:create:${token}`)),
      causationId: must(parseCausationId(`causation:create:${token}`)),
      effectiveAt: TEST_INSTANT,
      expectedStateVersion: must(createPortfolioStateVersion(0, true)),
    },
    eventId: must(parseEventId(`event:create:${token}`)),
  }))
}
