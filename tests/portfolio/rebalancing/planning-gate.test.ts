import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PlanningSnapshotAssembler,
  parseCalendarSessionId,
  parseCostScheduleVersionId,
  parseTaxRuleVersionId,
  parseTurnoverSnapshotId,
  validatePlanningContext,
  type NormalizedPlanningContext,
  type PlanningSnapshot,
} from '../../../server/portfolio/index.ts'
import {
  FIXTURE_IDS,
  makeAssemblyRequest,
  makeFakePorts,
  makePlanningSnapshot,
  makePortfolioSnapshot,
  makeStrategyConfig,
} from './support/fixtures.ts'

async function assemble(snapshot = makePlanningSnapshot()) {
  const ports = makeFakePorts({ snapshot })
  return new PlanningSnapshotAssembler(ports).assemble(makeAssemblyRequest())
}

test('planning gate accepts canonical frozen scope and creates its input hash', async () => {
  const result = await assemble()
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.context.portfolioId, FIXTURE_IDS.portfolioId)
  assert.match(result.value.context.planInputHash ?? '', /^[a-f0-9]{64}$/u)
  assert.equal(Object.isFrozen(result.value.context), true)
})

test('U04 branded schedule and session identifiers use the canonical parser', () => {
  for (const parser of [
    parseCostScheduleVersionId,
    parseTaxRuleVersionId,
    parseTurnoverSnapshotId,
    parseCalendarSessionId,
  ]) {
    assert.equal(parser('CANONICAL-U04-ID').ok, true)
    assert.equal(parser(' invalid ').ok, false)
    assert.equal(parser('').ok, false)
  }
})

test('planning gate rejects archived and cross-portfolio snapshots', async () => {
  const archived = await assemble(makePlanningSnapshot({
    portfolio: makePortfolioSnapshot({ status: 'ARCHIVED' }),
  }))
  assert.equal(archived.ok, false)
  if (!archived.ok) assert.equal(archived.error.code, 'PORTFOLIO_ARCHIVED')

  const valid = await assemble()
  assert.equal(valid.ok, true)
  if (!valid.ok) return
  const contaminated = {
    ...valid.value.context,
    holdings: Object.freeze([Object.freeze({
      ...valid.value.context.holdings[0],
      portfolioId: 'OTHER-PORTFOLIO',
    })]),
    planInputHash: undefined,
  } as unknown as NormalizedPlanningContext
  const result = validatePlanningContext(contaminated)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'PORTFOLIO_SCOPE_MISMATCH')
})

test('planning gate rejects non-finalized and same-session metadata', async () => {
  const base = makePlanningSnapshot()
  const result = await assemble(makePlanningSnapshot({
    session: Object.freeze({
      ...base.session,
      finalized: false,
      sameSessionExecutionAllowed: true,
      eligibleExecutionDate: base.session.sessionDate,
    }) as unknown as PlanningSnapshot['session'],
  }))
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'INVALID_SESSION_CONTEXT')
})

test('planning gate rejects missing immutable lineage', async () => {
  const result = await assemble(makePlanningSnapshot({
    reconciliationSnapshotId: '',
  }))
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'MISSING_PLANNING_LINEAGE')
})

test('planning gate rejects oversized collections before ranking', async () => {
  const base = makePlanningSnapshot()
  const evaluations = Array.from(
    { length: 1_001 },
    (_, index) => Object.freeze({
      ...base.evaluations[0],
      signal: Object.freeze({
        ...base.evaluations[0]?.signal,
        instrumentId: `OVERSIZED-${index}`,
      }),
      eligibility: Object.freeze({
        ...base.evaluations[0]?.eligibility,
        instrumentId: `OVERSIZED-${index}`,
      }),
    }),
  ) as unknown as PlanningSnapshot['evaluations']
  const result = await assemble(makePlanningSnapshot({ evaluations }))
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'CAPACITY_EXCEEDED')
})

test('planning gate rejects unsupported cadence enums', async () => {
  const result = await assemble(makePlanningSnapshot({
    strategyConfig: Object.freeze({
      ...makeStrategyConfig(),
      rebalance: Object.freeze({
        ...makeStrategyConfig().rebalance,
        routineFrequency: 'DAILY',
      }),
    }),
  }))
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'UNKNOWN_VALUE_REJECTED')
})

test('planning gate rejects a supplied hash that disagrees with canonical inputs', async () => {
  const valid = await assemble()
  assert.equal(valid.ok, true)
  if (!valid.ok) return
  const result = validatePlanningContext(Object.freeze({
    ...valid.value.context,
    planInputHash: 'f'.repeat(64),
  }) as NormalizedPlanningContext)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'NON_DETERMINISTIC_INPUT_MODEL')
})

test('snapshot assembly enforces the explicit dependency timeout budget', async () => {
  const ports = makeFakePorts()
  const assembler = new PlanningSnapshotAssembler({
    ...ports,
    snapshotPort: Object.freeze({
      loadPlanningSnapshot: async () => new Promise<never>(() => {}),
    }),
  })
  const result = await assembler.assemble(makeAssemblyRequest({
    dependencyTimeoutMs: 1,
  }))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.error.code, 'PLANNING_PREREQUISITE_UNSAFE')
    assert.equal(result.error.field, 'dependencyTimeoutMs')
  }
})
