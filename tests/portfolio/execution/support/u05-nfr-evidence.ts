import fs from 'node:fs'

export type U05NfrEvidence = Readonly<{
  nfrId: string
  description: string
  coveredIn: string
}>

const NFR_OWNERS = Object.freeze({
  CAP: 'tests/portfolio/execution/execution-run.test.ts, tests/portfolio/execution/persistence.test.ts, tests/portfolio/execution/execution.property.test.ts, benchmark/portfolio-execution.ts',
  PERF: 'benchmark/portfolio-execution.ts, tests/portfolio/execution/broker-contract.test.ts, tests/portfolio/execution/status-fill.test.ts',
  DET: 'tests/portfolio/execution/canonical-codec.test.ts, tests/portfolio/execution/execution.property.test.ts, tests/portfolio/execution/broker-contract.test.ts',
  AVAIL: 'tests/portfolio/execution/broker-contract.test.ts, tests/portfolio/execution/kill-switch-recovery.test.ts, tests/portfolio/execution/fault-injection.test.ts',
  REL: 'tests/portfolio/execution/placement.test.ts, tests/portfolio/execution/cancellation.test.ts, tests/portfolio/execution/execution.model.test.ts, tests/portfolio/execution/fault-injection.test.ts',
  SAFE: 'tests/portfolio/execution/execution-gate.test.ts, tests/portfolio/execution/status-fill.test.ts, tests/portfolio/execution/reconciliation.test.ts, tests/portfolio/execution/broker-contract.test.ts',
  SEC: 'tests/portfolio/execution/architecture.test.ts, tests/portfolio/execution/broker-contract.test.ts, tests/portfolio/execution/execution-gate.test.ts',
  OBS: 'tests/portfolio/execution/persistence.test.ts, tests/portfolio/execution/status-fill.test.ts, tests/portfolio/execution/reconciliation.test.ts, tests/portfolio/execution/fault-injection.test.ts',
  RSC: 'tests/portfolio/execution/architecture.test.ts, tests/portfolio/execution/persistence.test.ts, benchmark/portfolio-execution.ts',
  MAINT: 'tests/portfolio/execution/architecture.test.ts, tests/portfolio/execution/canonical-codec.test.ts, tests/portfolio/execution/persistence.test.ts',
  TEST: 'tests/portfolio/execution/architecture.test.ts, tests/portfolio/execution/broker-contract.test.ts, tests/portfolio/execution/fault-injection.test.ts',
  PBT: 'tests/portfolio/execution/execution.property.test.ts, tests/portfolio/execution/execution.model.test.ts, tests/portfolio/execution/canonical-codec.test.ts',
} as const)

const nfrDocument = fs.readFileSync(new URL(
  '../../../../aidlc-docs/construction/u05-execution-reconciliation/nfr-requirements/nfr-requirements.md',
  import.meta.url,
), 'utf8')

const parsedNfrs = [...nfrDocument.matchAll(
  /^\| (NFR-U05-(CAP|PERF|DET|AVAIL|REL|SAFE|SEC|OBS|RSC|MAINT|TEST|PBT)-\d{3}) \| ([^|]+?) \|/gmu,
)]

export const U05_NFR_EVIDENCE: readonly U05NfrEvidence[] = Object.freeze(parsedNfrs.map((match) => {
  const nfrId = match[1]
  const categoryName = match[2] as keyof typeof NFR_OWNERS | undefined
  const description = match[3]?.trim()
  if (!nfrId || !categoryName || !description) throw new Error('Malformed U05 NFR row')
  const coveredIn = NFR_OWNERS[categoryName]
  if (!coveredIn) throw new Error(`Missing executable owner for ${nfrId}`)
  return Object.freeze({ nfrId, description, coveredIn })
}))
