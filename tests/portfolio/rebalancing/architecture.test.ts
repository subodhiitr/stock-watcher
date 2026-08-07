import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as portfolioApi from '../../../server/portfolio/index.ts'
import { U04_RULE_EVIDENCE } from './support/u04-rule-evidence.ts'

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)
const portfolioRoot = path.join(workspaceRoot, 'server', 'portfolio')
const u04Directories = [
  path.join(portfolioRoot, 'domain', 'construction'),
  path.join(portfolioRoot, 'domain', 'rebalancing'),
  path.join(portfolioRoot, 'ports', 'rebalancing'),
  path.join(portfolioRoot, 'application', 'rebalancing'),
  path.join(portfolioRoot, 'adapters', 'optimization'),
]

function sourceFiles(directory: string): readonly string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    return entry.isDirectory()
      ? sourceFiles(absolute)
      : entry.name.endsWith('.ts') ? [absolute] : []
  })
}

test('U04 directories use strict erasable named-export TypeScript', () => {
  for (const directory of u04Directories) {
    assert.equal(fs.existsSync(directory), true, `${directory} must exist`)
    for (const file of sourceFiles(directory)) {
      const source = fs.readFileSync(file, 'utf8')
      assert.doesNotMatch(source, /export\s+\*\s+from/u)
      assert.doesNotMatch(source, /\benum\s+[A-Za-z_$]/u)
      assert.doesNotMatch(
        source,
        /constructor\s*\(\s*(?:private|public|protected|readonly)\s+/u,
      )
    }
  }
})

test('U04 has no legacy, persistence-internal, network, or ambient-state imports', () => {
  const forbidden = [
    'ticker_proxy',
    'dashboard-app',
    'simulation_engine',
    'backtest_simulation',
    'trade-execution',
    'paper-trades',
    'adapters/persistence',
    'infrastructure/persistence',
    'node:fs',
    'node:http',
    'node:https',
    'node:net',
  ]
  for (const directory of u04Directories) {
    for (const file of sourceFiles(directory)) {
      const source = fs.readFileSync(file, 'utf8')
      for (const token of forbidden) {
        assert.equal(source.includes(token), false, `${file} contains ${token}`)
      }
      assert.doesNotMatch(
        source,
        /\b(?:Date\.now|Math\.random|crypto\.randomUUID|process\.env)\b/u,
      )
    }
  }
})

test('U04 layer direction prevents adapter and implementation leakage', () => {
  for (const directory of [
    path.join(portfolioRoot, 'domain', 'construction'),
    path.join(portfolioRoot, 'domain', 'rebalancing'),
  ]) {
    for (const file of sourceFiles(directory)) {
      const source = fs.readFileSync(file, 'utf8')
      assert.doesNotMatch(source, /(?:application|adapters|ports)\//u)
    }
  }
  for (const file of sourceFiles(path.join(portfolioRoot, 'ports', 'rebalancing'))) {
    const source = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /domain\/(?:construction|rebalancing)\//u)
  }
  const optimizerPort = fs.readFileSync(
    path.join(portfolioRoot, 'ports', 'rebalancing', 'optimizer-port.ts'),
    'utf8',
  )
  assert.doesNotMatch(optimizerPort, /constraint-verifier/u)
})

test('U04 public surface and rule evidence are explicit and complete', () => {
  assert.equal(typeof portfolioApi.validatePlanningContext, 'function')
  assert.equal(typeof portfolioApi.constructIdealTarget, 'function')
  assert.equal(typeof portfolioApi.allocateWholeSharesGreedy, 'function')
  assert.equal(typeof portfolioApi.RebalancePlanningService, 'function')
  assert.equal(typeof portfolioApi.GreedyBaselineOptimizerAdapter, 'function')
  assert.equal(typeof portfolioApi.SmallProblemOracleOptimizerAdapter, 'function')
  assert.equal(U04_RULE_EVIDENCE.length, 117)
  const ids = U04_RULE_EVIDENCE.map((entry) => entry.ruleId)
  assert.equal(new Set(ids).size, 117)
  assert.ok(U04_RULE_EVIDENCE.every((entry) =>
    entry.description.length > 0 && entry.coveredIn.endsWith('.ts')))
})

test('U04 safe payloads cannot embed arbitrary provider or exception text', () => {
  const source = fs.readFileSync(
    path.join(
      portfolioRoot,
      'domain',
      'shared',
      'safe-observability-payload-builder.ts',
    ),
    'utf8',
  )
  assert.doesNotMatch(source, /\b(?:stack|rawMessage|providerMessage|aiText|accountNumber)\b/u)
  const bundle = portfolioApi.buildSafeReasonBundle({
    primaryCode: 'TARGET_SELECTED',
    explanationKey: 'TARGET_SELECTED',
  })
  assert.equal(bundle.ok, true)
  if (bundle.ok) {
    assert.equal(
      bundle.value.humanExplanation,
      portfolioApi.EXPLANATION_TEMPLATES.TARGET_SELECTED,
    )
  }
})
