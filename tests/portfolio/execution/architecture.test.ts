import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as executionApi from '../../../server/portfolio/execution.ts'
import * as portfolioApi from '../../../server/portfolio/index.ts'
import { U05_NFR_EVIDENCE } from './support/u05-nfr-evidence.ts'
import { U05_RULE_EVIDENCE } from './support/u05-rule-evidence.ts'

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const portfolioRoot = path.join(workspaceRoot, 'server', 'portfolio')
const executionDirectories = [
  path.join(portfolioRoot, 'domain', 'execution'),
  path.join(portfolioRoot, 'ports', 'execution'),
  path.join(portfolioRoot, 'application', 'execution'),
  path.join(portfolioRoot, 'adapters', 'broker'),
]
const executionPersistenceFiles = [
  path.join(portfolioRoot, 'adapters', 'persistence', 'execution-codecs.ts'),
  path.join(portfolioRoot, 'adapters', 'persistence', 'execution-event-ledger.ts'),
  path.join(portfolioRoot, 'adapters', 'persistence', 'execution-repositories.ts'),
  path.join(portfolioRoot, 'adapters', 'persistence', 'execution-statement-catalog.ts'),
  path.join(portfolioRoot, 'adapters', 'persistence', 'execution-unit-of-work.ts'),
  path.join(portfolioRoot, 'infrastructure', 'persistence', 'migrations', '002-execution-schema.ts'),
  path.join(portfolioRoot, 'domain', 'events', 'execution-events.ts'),
  path.join(portfolioRoot, 'domain', 'events', 'execution-event-codecs.ts'),
]

function sourceFiles(directory: string): readonly string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    return entry.isDirectory()
      ? sourceFiles(absolute)
      : entry.name.endsWith('.ts') ? [absolute] : []
  })
}

function executionFiles(): readonly string[] {
  return Object.freeze([
    ...executionDirectories.flatMap((directory) => sourceFiles(directory)),
    ...executionPersistenceFiles,
    path.join(portfolioRoot, 'execution.ts'),
  ])
}

test('U05 execution directories use strict erasable named export TypeScript', () => {
  for (const file of executionFiles()) {
    const source = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /export\s+\*\s+from/u)
    assert.doesNotMatch(source, /\benum\s+[A-Za-z_$]/u)
    assert.doesNotMatch(source, /constructor\s*\(\s*(?:private|public|protected|readonly)\s+/u)
  }
})

test('U05 execution runtime preserves import and credential boundaries', () => {
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
    'tests/portfolio',
    'benchmark/',
    'process.env',
  ]
  for (const file of executionFiles()) {
    const source = fs.readFileSync(file, 'utf8')
    for (const token of forbidden) {
      assert.equal(source.includes(token), false, `${file} contains ${token}`)
    }
    assert.doesNotMatch(source, /\b(?:password|secret|credentialLoader|kiteconnect|sharekhan-sdk)\b/u)
    assert.doesNotMatch(source, /\b(?:Date\.now|Math\.random|crypto\.randomUUID)\s*\(/u)
  }
  for (const file of sourceFiles(path.join(portfolioRoot, 'domain', 'execution'))) {
    const source = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /(?:ports|application|adapters|infrastructure)\//u)
  }
  for (const file of sourceFiles(path.join(portfolioRoot, 'ports', 'execution'))) {
    const source = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /adapters\/persistence/u)
  }
})

test('U05 execution import graph is acyclic inside the execution subtree', () => {
  const files = executionFiles()
  const graph = new Map<string, string[]>()
  const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gu
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    const edges: string[] = []
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1]
      if (!specifier || !specifier.startsWith('.')) continue
      const target = path.resolve(path.dirname(file), specifier)
      assert.equal(fs.existsSync(target), true, `${file} references ${specifier}`)
      edges.push(target)
    }
    graph.set(file, edges)
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  function visit(file: string): void {
    if (visiting.has(file)) assert.fail(`cycle at ${file}`)
    if (visited.has(file)) return
    visiting.add(file)
    for (const dependency of graph.get(file) ?? []) {
      if (graph.has(dependency)) visit(dependency)
    }
    visiting.delete(file)
    visited.add(file)
  }
  for (const file of files) visit(file)
})

test('U05 public surfaces are explicit and evidence tables are complete', () => {
  assert.equal(typeof executionApi.ApprovalService, 'function')
  assert.equal(typeof executionApi.ExecutionRunService, 'function')
  assert.equal(typeof executionApi.PlacementCoordinator, 'function')
  assert.equal(typeof executionApi.StatusFillCoordinator, 'function')
  assert.equal(typeof executionApi.CancellationCoordinator, 'function')
  assert.equal(typeof executionApi.ReconciliationService, 'function')
  assert.equal(typeof executionApi.RecoveryService, 'function')
  assert.equal(typeof executionApi.KillSwitchService, 'function')
  assert.equal(typeof executionApi.ExecutionCoordinator, 'function')
  assert.equal(typeof executionApi.composeTrustedExecutionBroker, 'function')
  assert.equal(typeof executionApi.DeterministicPaperBroker, 'function')
  assert.equal(typeof executionApi.DryRunBroker, 'function')
  assert.equal(typeof executionApi.BrokerResilienceGovernor, 'function')
  assert.equal(portfolioApi.ApprovalService, executionApi.ApprovalService)
  assert.equal(portfolioApi.composeTrustedExecutionBroker, executionApi.composeTrustedExecutionBroker)

  assert.equal(U05_RULE_EVIDENCE.length, 124)
  assert.equal(new Set(U05_RULE_EVIDENCE.map((entry) => entry.ruleId)).size, 124)
  assert.ok(U05_RULE_EVIDENCE.every((entry) =>
    entry.ruleId.length > 0 && entry.description.length > 0 && entry.coveredIn.length > 0))

  assert.equal(U05_NFR_EVIDENCE.length, 134)
  assert.equal(new Set(U05_NFR_EVIDENCE.map((entry) => entry.nfrId)).size, 134)
  assert.ok(U05_NFR_EVIDENCE.every((entry) =>
    entry.nfrId.length > 0 && entry.description.length > 0 && entry.coveredIn.length > 0))
})
