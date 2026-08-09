import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as portfolioApi from '../../server/portfolio/index.ts'
import { RULE_EVIDENCE } from './support/rule-evidence.ts'
import { U03_RULE_EVIDENCE } from './strategy/support/u03-rule-evidence.ts'
import { U04_RULE_EVIDENCE } from './rebalancing/support/u04-rule-evidence.ts'
import { U05_NFR_EVIDENCE } from './execution/support/u05-nfr-evidence.ts'
import { U05_RULE_EVIDENCE } from './execution/support/u05-rule-evidence.ts'

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const sourceRoot = path.join(workspaceRoot, 'server', 'portfolio')

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    return entry.isDirectory()
      ? sourceFiles(absolute)
      : entry.name.endsWith('.ts')
        ? [absolute]
        : []
  })
}

test('portfolio domain has zero runtime dependencies and no forbidden imports', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'),
  ) as Record<string, unknown>
  assert.equal(packageJson.dependencies, undefined)

  const forbidden = [
    'better-sqlite3',
    'kiteconnect',
    'sharekhan',
    'ticker_proxy',
    'dashboard-app',
    'simulation_engine',
    'node:fs',
    'node:http',
    'node:https',
    'node:net',
  ]
  const domainBoundaryFiles = [
    ...sourceFiles(path.join(sourceRoot, 'domain')),
    ...sourceFiles(path.join(sourceRoot, 'ports')),
  ]
  for (const file of domainBoundaryFiles) {
    const source = fs.readFileSync(file, 'utf8')
    for (const token of forbidden) {
      assert.equal(source.includes(token), false, `${file} imports ${token}`)
    }
    assert.doesNotMatch(source, /export\s+\*\s+from/u)
    assert.doesNotMatch(source, /\b(Date\.now|Math\.random|crypto\.randomUUID)\s*\(/u)
  }
})

test('portfolio source import graph is acyclic and stays inside its boundary', () => {
  const files = sourceFiles(sourceRoot)
  const graph = new Map<string, string[]>()
  const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gu

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    const edges: string[] = []
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1]
      assert.ok(specifier)
      if (!specifier.startsWith('.')) continue
      const target = path.resolve(path.dirname(file), specifier)
      assert.equal(target.startsWith(sourceRoot), true, `${file} escapes source boundary`)
      assert.equal(fs.existsSync(target), true, `${file} references missing ${specifier}`)
      edges.push(target)
    }
    graph.set(file, edges)
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  function visit(file: string): void {
    if (visiting.has(file)) {
      assert.fail(`Portfolio import cycle reaches ${file}`)
    }
    if (visited.has(file)) return
    visiting.add(file)
    for (const dependency of graph.get(file) ?? []) visit(dependency)
    visiting.delete(file)
    visited.add(file)
  }
  for (const file of files) visit(file)
})

test('public entry point imports without side effects and exposes reviewed capabilities', () => {
  assert.equal(typeof portfolioApi.Portfolio, 'function')
  assert.equal(typeof portfolioApi.createMoney, 'function')
  assert.equal(typeof portfolioApi.serializeDomainEvent, 'function')
  assert.equal('publish' in portfolioApi, false)
  assert.equal('connect' in portfolioApi, false)
  assert.equal('executeOrder' in portfolioApi, false)
})

test('all 72 U01 business rules have executable evidence labels', () => {
  const ranges = [
    [1, 8],
    [10, 15],
    [20, 26],
    [30, 36],
    [40, 43],
    [50, 59],
    [60, 70],
    [80, 86],
    [90, 95],
    [100, 105],
  ] as const
  const expected = ranges.flatMap(([start, end]) =>
    Array.from(
      { length: end - start + 1 },
      (_, index) => `BR-U01-${String(start + index).padStart(3, '0')}`,
    ))
  const actual = Object.keys(RULE_EVIDENCE).sort()

  assert.equal(expected.length, 72)
  assert.equal(actual.length, 72)
  assert.deepEqual(actual, expected.sort())
  for (const evidence of Object.values(RULE_EVIDENCE)) {
    assert.match(evidence, /^(exact-values|portfolio|portfolio-property|portfolio-model|events|architecture):/u)
  }
})

test('U03 strategy domain and ports directories follow architecture rules', () => {
  const u03DomainDirs = [
    path.join(sourceRoot, 'domain', 'strategy'),
    path.join(sourceRoot, 'domain', 'market-data'),
    path.join(sourceRoot, 'ports', 'market-data'),
    path.join(sourceRoot, 'ports', 'strategy'),
  ]
  const forbidden = [
    'better-sqlite3', 'kiteconnect', 'sharekhan', 'ticker_proxy',
    'node:fs', 'node:http', 'node:https', 'node:net',
  ]
  for (const dir of u03DomainDirs) {
    if (!fs.existsSync(dir)) continue
    for (const file of sourceFiles(dir)) {
      const source = fs.readFileSync(file, 'utf8')
      for (const token of forbidden) {
        assert.equal(source.includes(token), false, `U03 ${file} imports ${token}`)
      }
    }
  }
})

test('U03 rule evidence covers 140 rules', () => {
  assert.equal(U03_RULE_EVIDENCE.length, 140, `Expected 140 U03 rule evidence entries, got ${U03_RULE_EVIDENCE.length}`)
  // All entries must have ruleId, description, coveredIn
  for (const entry of U03_RULE_EVIDENCE) {
    assert.ok(entry.ruleId.length > 0, 'ruleId must be non-empty')
    assert.ok(entry.description.length > 0, 'description must be non-empty')
    assert.ok(entry.coveredIn.length > 0, 'coveredIn must be non-empty')
  }
  // Rule IDs must be unique
  const ids = U03_RULE_EVIDENCE.map(e => e.ruleId)
  const uniqueIds = new Set(ids)
  assert.equal(uniqueIds.size, 140, `U03 rule IDs must be unique, found ${140 - uniqueIds.size} duplicates`)
})

test('U04 rule evidence covers 117 unique rules', () => {
  assert.equal(
    U04_RULE_EVIDENCE.length,
    117,
    `Expected 117 U04 rule evidence entries, got ${U04_RULE_EVIDENCE.length}`,
  )
  const ids = U04_RULE_EVIDENCE.map((entry) => entry.ruleId)
  assert.equal(new Set(ids).size, 117)
  for (const entry of U04_RULE_EVIDENCE) {
    assert.ok(entry.ruleId.length > 0)
    assert.ok(entry.description.length > 0)
    assert.ok(entry.coveredIn.length > 0)
  }
})

test('U04 runtime directories preserve portfolio import boundaries', () => {
  const u04Directories = [
    path.join(sourceRoot, 'domain', 'construction'),
    path.join(sourceRoot, 'domain', 'rebalancing'),
    path.join(sourceRoot, 'ports', 'rebalancing'),
    path.join(sourceRoot, 'application', 'rebalancing'),
    path.join(sourceRoot, 'adapters', 'optimization'),
  ]
  const forbidden = [
    'ticker_proxy',
    'dashboard-app',
    'simulation_engine',
    'backtest_simulation',
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
      assert.doesNotMatch(source, /export\s+\*\s+from/u)
      for (const token of forbidden) {
        assert.equal(source.includes(token), false, `U04 ${file} imports ${token}`)
      }
    }
  }
})

test('U05 rule and NFR evidence covers 124 and 134 unique rows', () => {
  assert.equal(
    U05_RULE_EVIDENCE.length,
    124,
    `Expected 124 U05 rule evidence entries, got ${U05_RULE_EVIDENCE.length}`,
  )
  assert.equal(
    U05_NFR_EVIDENCE.length,
    134,
    `Expected 134 U05 NFR evidence entries, got ${U05_NFR_EVIDENCE.length}`,
  )
  const ruleIds = U05_RULE_EVIDENCE.map((entry) => entry.ruleId)
  const nfrIds = U05_NFR_EVIDENCE.map((entry) => entry.nfrId)
  assert.equal(new Set(ruleIds).size, 124)
  assert.equal(new Set(nfrIds).size, 134)
  for (const entry of U05_RULE_EVIDENCE) {
    assert.ok(entry.ruleId.length > 0)
    assert.ok(entry.description.length > 0)
    assert.ok(entry.coveredIn.length > 0)
  }
  for (const entry of U05_NFR_EVIDENCE) {
    assert.ok(entry.nfrId.length > 0)
    assert.ok(entry.description.length > 0)
    assert.ok(entry.coveredIn.length > 0)
  }
})

test('U05 runtime directories preserve portfolio import boundaries', () => {
  const u05Directories = [
    path.join(sourceRoot, 'domain', 'execution'),
    path.join(sourceRoot, 'ports', 'execution'),
    path.join(sourceRoot, 'application', 'execution'),
    path.join(sourceRoot, 'adapters', 'broker'),
  ]
  const extraFiles = [
    path.join(sourceRoot, 'adapters', 'persistence', 'execution-codecs.ts'),
    path.join(sourceRoot, 'adapters', 'persistence', 'execution-event-ledger.ts'),
    path.join(sourceRoot, 'adapters', 'persistence', 'execution-repositories.ts'),
    path.join(sourceRoot, 'adapters', 'persistence', 'execution-statement-catalog.ts'),
    path.join(sourceRoot, 'adapters', 'persistence', 'execution-unit-of-work.ts'),
  ]
  const forbidden = [
    'ticker_proxy',
    'dashboard-app',
    'simulation_engine',
    'backtest_simulation',
    'trade-execution',
    'paper-trades',
    'node:fs',
    'node:http',
    'node:https',
    'node:net',
    'process.env',
  ]
  for (const directory of u05Directories) {
    for (const file of sourceFiles(directory)) {
      const source = fs.readFileSync(file, 'utf8')
      assert.doesNotMatch(source, /export\s+\*\s+from/u)
      for (const token of forbidden) {
        assert.equal(source.includes(token), false, `U05 ${file} imports ${token}`)
      }
      assert.doesNotMatch(source, /\b(?:Date\.now|Math\.random|crypto\.randomUUID)\s*\(/u)
      assert.doesNotMatch(source, /\b(?:password|secret|credentialLoader)\b/u)
    }
  }
  for (const file of extraFiles) {
    const source = fs.readFileSync(file, 'utf8')
    for (const token of forbidden) {
      assert.equal(source.includes(token), false, `U05 ${file} imports ${token}`)
    }
  }
})

test('events and failures expose no credential or broker-account fields', () => {
  const eventSource = fs.readFileSync(
    path.join(sourceRoot, 'domain', 'events', 'domain-events.ts'),
    'utf8',
  )
  const failureSource = fs.readFileSync(
    path.join(sourceRoot, 'domain', 'errors', 'failure.ts'),
    'utf8',
  )
  for (const forbidden of ['password', 'secret', 'token', 'credential', 'brokerAccount']) {
    assert.equal(eventSource.includes(forbidden), false)
    assert.equal(failureSource.includes(forbidden), false)
  }
})
