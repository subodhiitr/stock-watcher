import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const evidence: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'US-001': ['tests/portfolio/persistence/initialization.test.ts'],
  'US-002': ['tests/portfolio/portfolio.test.ts', 'tests/portfolio/u09/integrated-acceptance.test.ts'],
  'US-003': ['my-remix-app/app/portfolio/state/request-coordinator.test.ts'],
  'US-004': ['tests/portfolio/portfolio.test.ts', 'tests/portfolio/u09/integrated-acceptance.test.ts'],
  'US-005': ['tests/portfolio/portfolio.test.ts'],
  'US-006': ['tests/portfolio/strategy/presets.property.test.ts'],
  'US-007': ['tests/portfolio/strategy/strategy-version.test.ts'],
  'US-008': ['tests/portfolio/strategy/eligibility.test.ts', 'tests/portfolio/strategy/strategy-version.test.ts'],
  'US-009': ['tests/portfolio/exact-values.test.ts'],
  'US-010': ['tests/portfolio/strategy/market-data.test.ts'],
  'US-011': ['tests/portfolio/strategy/corporate-action.test.ts'],
  'US-012': ['tests/portfolio/strategy/signal-scoring.test.ts'],
  'US-013': ['tests/portfolio/strategy/resilience.test.ts'],
  'US-014': ['tests/portfolio/strategy/backtest.test.ts'],
  'US-015': ['tests/portfolio/rebalancing/ideal-target.test.ts'],
  'US-016': ['tests/portfolio/rebalancing/executable-target.test.ts'],
  'US-017': ['tests/portfolio/rebalancing/cost-tax.test.ts'],
  'US-018': ['tests/portfolio/rebalancing/rebalance-plan.test.ts'],
  'US-019': ['tests/portfolio/rebalancing/cadence-turnover.test.ts'],
  'US-020': ['tests/portfolio/rebalancing/optimizer.test.ts'],
  'US-021': ['tests/portfolio/execution/broker-contract.test.ts'],
  'US-022': ['tests/portfolio/execution/execution-gate.test.ts', 'tests/portfolio/execution/architecture.test.ts'],
  'US-023': ['tests/portfolio/execution/approval.test.ts'],
  'US-024': ['tests/portfolio/execution/placement.test.ts', 'tests/portfolio/execution/canonical-codec.test.ts'],
  'US-025': ['tests/portfolio/execution/reconciliation.test.ts'],
  'US-026': ['tests/portfolio/execution/broker-contract.test.ts'],
  'US-027': ['tests/portfolio/execution/kill-switch-recovery.test.ts'],
  'US-028': ['tests/portfolio/operations/basic-operations.test.ts'],
  'US-029': ['tests/portfolio/operations/basic-operations.test.ts'],
  'US-030': ['tests/portfolio/u09/restore-drill.test.ts'],
  'US-031': ['tests/portfolio/operations/basic-operations.test.ts'],
  'US-032': ['my-remix-app/app/actions/portfolio/controller.test.tsx'],
  'US-033': ['my-remix-app/app/actions/portfolio/controller.test.tsx'],
  'US-034': ['tests/portfolio/api/http-runtime.test.ts', 'tests/portfolio/api/secure-handler.test.ts'],
  'US-035': ['tests/portfolio/operations/basic-operations.test.ts', 'tests/portfolio/persistence/transactions.test.ts'],
  'US-036': ['tests/portfolio/strategy/backtest.test.ts'],
  'US-037': ['tests/portfolio/strategy/backtest.test.ts', 'tests/portfolio/strategy/presets.property.test.ts'],
  'US-038': ['tests/portfolio/strategy/ai-advisory.test.ts'],
  'US-039': ['tests/portfolio/u09/delivery-safety.test.ts', 'benchmark/portfolio-integrated.ts'],
})

test('U09 traceability assigns executable evidence to all 39 stories', () => {
  const expected = Array.from({ length: 39 }, (_, index) => `US-${String(index + 1).padStart(3, '0')}`)
  assert.deepEqual(Object.keys(evidence).sort(), expected)
  for (const [storyId, files] of Object.entries(evidence)) {
    assert.ok(files.length > 0, `${storyId} has no evidence`)
    for (const file of files) {
      assert.equal(fs.existsSync(path.join(process.cwd(), file)), true, `${storyId}: ${file}`)
    }
  }
})
