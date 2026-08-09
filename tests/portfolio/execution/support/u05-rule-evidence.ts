import fs from 'node:fs'

export type U05RuleEvidence = Readonly<{
  ruleId: string
  description: string
  coveredIn: string
}>

const RULE_OWNERS = Object.freeze({
  BND: 'tests/portfolio/execution/canonical-codec.test.ts, tests/portfolio/execution/architecture.test.ts, tests/portfolio/execution/persistence.test.ts',
  APR: 'tests/portfolio/execution/approval.test.ts, tests/portfolio/execution/execution.property.test.ts',
  CNV: 'tests/portfolio/execution/execution-run.test.ts, tests/portfolio/execution/execution.property.test.ts',
  GAT: 'tests/portfolio/execution/execution-gate.test.ts, tests/portfolio/execution/placement.test.ts',
  IDM: 'tests/portfolio/execution/canonical-codec.test.ts, tests/portfolio/execution/placement.test.ts, tests/portfolio/execution/persistence.test.ts, tests/portfolio/execution/fault-injection.test.ts',
  ORD: 'tests/portfolio/execution/execution-order.test.ts, tests/portfolio/execution/placement.test.ts, tests/portfolio/execution/cancellation.test.ts, tests/portfolio/execution/status-fill.test.ts',
  FIL: 'tests/portfolio/execution/status-fill.test.ts, tests/portfolio/execution/execution.property.test.ts, tests/portfolio/execution/persistence.test.ts',
  REC: 'tests/portfolio/execution/reconciliation.test.ts, tests/portfolio/execution/kill-switch-recovery.test.ts, tests/portfolio/execution/fault-injection.test.ts',
  BRK: 'tests/portfolio/execution/broker-contract.test.ts, tests/portfolio/execution/architecture.test.ts',
  KIL: 'tests/portfolio/execution/kill-switch-recovery.test.ts, tests/portfolio/execution/cancellation.test.ts',
  AUD: 'tests/portfolio/execution/persistence.test.ts, tests/portfolio/execution/fault-injection.test.ts, tests/portfolio/execution/architecture.test.ts',
  ABU: 'tests/portfolio/execution/architecture.test.ts, tests/portfolio/execution/broker-contract.test.ts',
} as const)

const rulesDocument = fs.readFileSync(new URL(
  '../../../../aidlc-docs/construction/u05-execution-reconciliation/functional-design/business-rules.md',
  import.meta.url,
), 'utf8')

const parsedRules = [...rulesDocument.matchAll(
  /^\| ((?:BND|APR|CNV|GAT|IDM|ORD|FIL|REC|BRK|KIL|AUD|ABU)-\d{3}) \| ([^|]+?) \|/gmu,
)]

export const U05_RULE_EVIDENCE: readonly U05RuleEvidence[] = Object.freeze(parsedRules.map((match) => {
  const ruleId = match[1]
  const description = match[2]?.trim()
  if (!ruleId || !description) throw new Error('Malformed U05 functional-rule row')
  const subsystemName = ruleId.slice(0, 3) as keyof typeof RULE_OWNERS
  const coveredIn = RULE_OWNERS[subsystemName]
  if (!coveredIn) throw new Error(`Missing executable owner for ${ruleId}`)
  return Object.freeze({ ruleId, description, coveredIn })
}))
