import type Database from 'better-sqlite3'

import { failure, success } from '../../domain/errors/result.ts'
import {
  parseActorId,
  parseAllocationId,
  parseEvidenceId,
  parseHoldingId,
  parseHoldingLotId,
  parseInstrumentId,
  parsePortfolioId,
  parseStrategyAssignmentId,
  parseStrategySleeveId,
  parseStrategyVersionId,
  type PortfolioId,
} from '../../domain/shared/identifiers.ts'
import { createMoney } from '../../domain/shared/money.ts'
import { createQuantity } from '../../domain/shared/quantity.ts'
import { createPortfolioStateVersion } from '../../domain/shared/state-version.ts'
import { parseInstant, parseLocalDate } from '../../domain/shared/time.ts'
import { createWeight } from '../../domain/shared/weight.ts'
import {
  createStrategyEligibilityEvidence,
  parseIntegrityHash,
  type OperatingMode,
} from '../../domain/portfolio/evidence.ts'
import type { Holding } from '../../domain/portfolio/holding.ts'
import type {
  HoldingLot,
  LotSourceKind,
} from '../../domain/portfolio/holding-lot.ts'
import {
  Portfolio,
  createPortfolioName,
  type PortfolioSnapshot,
} from '../../domain/portfolio/portfolio.ts'
import type { PortfolioStatus } from '../../domain/portfolio/integrity.ts'
import {
  allocationPolicyIdentity,
  createMultiSleeveAllocation,
  createSingleStrategyAllocation,
  type StrategyAllocationPolicy,
} from '../../domain/portfolio/strategy-allocation.ts'
import {
  persistenceFailure,
  type PersistenceResult,
} from '../../infrastructure/persistence/failures.ts'
import {
  decodeMoney,
  decodeQuantity,
  decodeWeight,
  encodeMoney,
  encodeQuantity,
  encodeWeight,
} from './codecs.ts'
import { SQL } from './statement-catalog.ts'

type PortfolioRow = {
  portfolio_id: string
  display_name: string
  normalized_name_key: string
  base_currency: string
  created_at: string
  status: string
  operating_mode: string
  cash_minor_units: string
  state_version: number
}

type AllocationRow = {
  allocation_record_id: string
  policy_identity: string
  policy_kind: string
  effective_at: string
  valid_from_version: number
}

type AssignmentRow = {
  assignment_id: string
  sleeve_id: string | null
  strategy_version_id: string
  weight_ppm: number
  effective_at: string
  evidence_id: string
  evidence_hash: string
  evidence_issuer_id: string
  evidence_issued_at: string
  evidence_expires_at: string
}

type HoldingRow = {
  holding_id: string
  portfolio_id: string
  instrument_id: string
  total_quantity: string
  available_delivery_quantity: string
  reserved_quantity: string
  state_version: number
  margin_funded: number
}

type LotRow = {
  lot_id: string
  holding_id: string
  portfolio_id: string
  instrument_id: string
  acquired_on: string
  original_quantity: string
  open_quantity: string
  unit_cost_minor_units: string
  source_kind: string
  source_reference_id: string
}

function decode<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) throw new Error('PERSISTENCE_DECODE_FAILED')
  return result.value
}

function decodeAllocation(
  database: Database.Database,
  owner: PortfolioId,
  row: AllocationRow,
): StrategyAllocationPolicy {
  const effectiveAt = decode(parseInstant(row.effective_at))
  const assignments = database.prepare(SQL.selectAssignments).all(
    row.allocation_record_id,
  ) as AssignmentRow[]
  if (assignments.length === 0) throw new Error('MISSING_ASSIGNMENT')

  function assignmentEvidence(item: AssignmentRow) {
    const strategyVersionId = decode(parseStrategyVersionId(item.strategy_version_id))
    const evidence = decode(createStrategyEligibilityEvidence({
      evidenceId: decode(parseEvidenceId(item.evidence_id)),
      portfolioId: owner,
      strategyVersionId,
      issuerId: decode(parseActorId(item.evidence_issuer_id)),
      issuedAt: decode(parseInstant(item.evidence_issued_at)),
      expiresAt: decode(parseInstant(item.evidence_expires_at)),
      evidenceHash: decode(parseIntegrityHash(item.evidence_hash)),
    }))
    return { strategyVersionId, evidence }
  }

  if (row.policy_kind === 'SINGLE') {
    if (assignments.length !== 1) throw new Error('INVALID_SINGLE_ASSIGNMENT')
    const item = assignments[0]
    if (item === undefined || item.sleeve_id !== null) {
      throw new Error('INVALID_SINGLE_ASSIGNMENT')
    }
    const evidence = assignmentEvidence(item)
    return decode(createSingleStrategyAllocation(owner, {
      assignmentId: decode(parseStrategyAssignmentId(item.assignment_id)),
      strategyVersionId: evidence.strategyVersionId,
      weight: decode(decodeWeight(item.weight_ppm)),
      effectiveAt,
      evidenceReference: evidence.evidence,
    }))
  }

  if (row.policy_kind !== 'SLEEVES') throw new Error('INVALID_ALLOCATION_KIND')
  const sleeves = assignments.map((item) => {
    if (item.sleeve_id === null) throw new Error('MISSING_SLEEVE_ID')
    const evidence = assignmentEvidence(item)
    return {
      sleeveId: decode(parseStrategySleeveId(item.sleeve_id)),
      assignmentId: decode(parseStrategyAssignmentId(item.assignment_id)),
      strategyVersionId: evidence.strategyVersionId,
      weight: decode(decodeWeight(item.weight_ppm)),
      effectiveAt: decode(parseInstant(item.effective_at)),
      evidenceReference: evidence.evidence,
    }
  })
  return decode(createMultiSleeveAllocation(owner, {
    allocationId: decode(parseAllocationId(row.policy_identity)),
    sleeves,
    effectiveAt,
  }))
}

export function loadPortfolio(
  database: Database.Database,
  portfolioId: PortfolioId,
): PersistenceResult<Portfolio | undefined> {
  try {
    const row = database.prepare(SQL.selectPortfolio).get(portfolioId) as
      | PortfolioRow
      | undefined
    if (row === undefined) return success(undefined)

    const owner = decode(parsePortfolioId(row.portfolio_id))
    const name = decode(createPortfolioName(row.display_name))
    if (name.uniquenessKey !== row.normalized_name_key || row.base_currency !== 'INR') {
      throw new Error('INVALID_PORTFOLIO_ROOT')
    }
    const allocationRow = database.prepare(SQL.selectCurrentAllocation).get(
      portfolioId,
    ) as AllocationRow | undefined
    if (allocationRow === undefined) throw new Error('MISSING_ALLOCATION')

    const holdingRows = database.prepare(SQL.selectHoldings).all(portfolioId) as HoldingRow[]
    const lotRows = database.prepare(SQL.selectLots).all(portfolioId) as LotRow[]
    const lotsByHolding = new Map<string, LotRow[]>()
    for (const lot of lotRows) {
      const collection = lotsByHolding.get(lot.holding_id) ?? []
      collection.push(lot)
      lotsByHolding.set(lot.holding_id, collection)
    }

    const holdings = holdingRows.map((holdingRow) => {
      const instrumentId = decode(parseInstrumentId(holdingRow.instrument_id))
      if (holdingRow.portfolio_id !== owner) throw new Error('HOLDING_SCOPE_MISMATCH')
      const lots: readonly HoldingLot[] = Object.freeze(
        (lotsByHolding.get(holdingRow.holding_id) ?? []).map((lotRow) => {
          if (
            lotRow.portfolio_id !== owner
            || lotRow.instrument_id !== instrumentId
          ) {
            throw new Error('LOT_SCOPE_MISMATCH')
          }
          return Object.freeze({
            lotId: decode(parseHoldingLotId(lotRow.lot_id)),
            portfolioId: owner,
            instrumentId,
            acquiredOn: decode(parseLocalDate(lotRow.acquired_on)),
            originalQuantity: decode(decodeQuantity(lotRow.original_quantity)),
            openQuantity: decode(decodeQuantity(lotRow.open_quantity)),
            unitCost: decode(decodeMoney(lotRow.unit_cost_minor_units)),
            sourceReference: Object.freeze({
              kind: lotRow.source_kind as LotSourceKind,
              referenceId: lotRow.source_reference_id,
            }),
          } satisfies HoldingLot)
        }),
      )
      return Object.freeze({
        holdingId: decode(parseHoldingId(holdingRow.holding_id)),
        portfolioId: owner,
        instrumentId,
        totalQuantity: decode(decodeQuantity(holdingRow.total_quantity)),
        availableDeliveryQuantity: decode(
          decodeQuantity(holdingRow.available_delivery_quantity),
        ),
        reservedQuantity: decode(decodeQuantity(holdingRow.reserved_quantity)),
        lots,
        stateVersion: decode(createPortfolioStateVersion(holdingRow.state_version)),
        marginFunded: false,
      } satisfies Holding)
    })

    const snapshot: PortfolioSnapshot = {
      portfolioId: owner,
      name,
      baseCurrency: 'INR',
      createdAt: decode(parseInstant(row.created_at)),
      status: row.status as PortfolioStatus,
      mode: row.operating_mode as OperatingMode,
      cash: decode(decodeMoney(row.cash_minor_units)),
      allocationPolicy: decodeAllocation(database, owner, allocationRow),
      holdings,
      stateVersion: decode(createPortfolioStateVersion(row.state_version)),
    }
    return success(Portfolio.rehydrate(snapshot))
  } catch {
    return failure(persistenceFailure('PORTFOLIO_REHYDRATION_FAILED'))
  }
}

export function insertAllocation(
  database: Database.Database,
  portfolio: Portfolio,
): void {
  const policy = portfolio.allocationPolicy
  const recordId = `allocation-record:${portfolio.portfolioId}:${portfolio.stateVersion}`
  database.prepare(SQL.insertAllocation).run(
    recordId,
    portfolio.portfolioId,
    allocationPolicyIdentity(policy),
    policy.kind,
    policy.effectiveAt,
    portfolio.stateVersion,
  )

  const assignments = policy.kind === 'SINGLE'
    ? [{
        assignmentId: policy.assignmentId,
        sleeveId: null,
        strategyVersionId: policy.strategyVersionId,
        weight: policy.weight,
        effectiveAt: policy.effectiveAt,
        evidence: policy.evidenceReference,
      }]
    : policy.sleeves.map((sleeve) => ({
        assignmentId: sleeve.assignmentId,
        sleeveId: sleeve.sleeveId,
        strategyVersionId: sleeve.strategyVersionId,
        weight: sleeve.weight,
        effectiveAt: sleeve.effectiveAt,
        evidence: sleeve.evidenceReference,
      }))

  for (const assignment of assignments) {
    database.prepare(SQL.insertAssignment).run(
      assignment.assignmentId,
      recordId,
      portfolio.portfolioId,
      assignment.sleeveId,
      assignment.strategyVersionId,
      encodeWeight(assignment.weight),
      assignment.effectiveAt,
      assignment.evidence.evidenceId,
      assignment.evidence.evidenceHash,
      assignment.evidence.issuerId,
      assignment.evidence.issuedAt,
      assignment.evidence.expiresAt,
    )
  }
}

export function replaceHoldings(
  database: Database.Database,
  portfolio: Portfolio,
): void {
  database.prepare(SQL.deleteLots).run(portfolio.portfolioId)
  database.prepare(SQL.deleteHoldings).run(portfolio.portfolioId)
  for (const holding of portfolio.holdings) {
    database.prepare(SQL.insertHolding).run(
      holding.holdingId,
      holding.portfolioId,
      holding.instrumentId,
      encodeQuantity(holding.totalQuantity),
      encodeQuantity(holding.availableDeliveryQuantity),
      encodeQuantity(holding.reservedQuantity),
      holding.stateVersion,
    )
    for (const lot of holding.lots) {
      database.prepare(SQL.insertLot).run(
        lot.lotId,
        holding.holdingId,
        lot.portfolioId,
        lot.instrumentId,
        lot.acquiredOn,
        encodeQuantity(lot.originalQuantity),
        encodeQuantity(lot.openQuantity),
        encodeMoney(lot.unitCost),
        lot.sourceReference.kind,
        lot.sourceReference.referenceId,
      )
    }
  }
}
