import type { HoldingLot } from '../portfolio/holding-lot.ts'
import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { HoldingLotId, TaxRuleVersionId } from '../shared/identifiers.ts'
import { createMoney, type Money } from '../shared/money.ts'
import { createQuantity, type Quantity } from '../shared/quantity.ts'
import {
  U04_MAX_TAX_LOTS,
  U04_RATE_SCALE,
} from '../shared/rebalancing-constants.ts'
import type { LocalDate } from '../shared/time.ts'

export type LotSelectionPolicy = 'FIFO' | 'HIFO' | 'SPECIFIC'

export type TaxRuleSet = Readonly<{
  taxRuleVersionId: TaxRuleVersionId
  effectiveFrom: LocalDate
  holdingPeriodThresholdDays: number
  shortTermRatePpm: bigint
  longTermRatePpm: bigint
  lotSelectionPolicy: LotSelectionPolicy
}>

export type SpecificLotInstruction = Readonly<{
  lotId: HoldingLotId
  quantity: Quantity
}>

export type LotDisposition = Readonly<{
  lotId: HoldingLotId
  sellQuantity: Quantity
  acquiredOn: LocalDate
  unitCost: Money
  estimatedGainOrLoss: Money
  termClassification: 'SHORT_TERM' | 'LONG_TERM'
}>

export type TaxEstimate = Readonly<{
  selectedLots: readonly LotDisposition[]
  taxableGainOrLoss: Money
  estimatedTax: Money
  taxRuleVersionId: TaxRuleVersionId
  isProvisional: boolean
}>

function epochDay(value: LocalDate): number {
  return Math.floor(Date.parse(`${value}T00:00:00.000Z`) / 86_400_000)
}

function sortedLots(
  lots: readonly HoldingLot[],
  policy: Exclude<LotSelectionPolicy, 'SPECIFIC'>,
): HoldingLot[] {
  return [...lots].sort((left, right) => {
    if (policy === 'HIFO' && left.unitCost.minorUnits !== right.unitCost.minorUnits) {
      return left.unitCost.minorUnits > right.unitCost.minorUnits ? -1 : 1
    }
    return left.acquiredOn < right.acquiredOn ? -1
      : left.acquiredOn > right.acquiredOn ? 1
        : left.lotId < right.lotId ? -1 : left.lotId > right.lotId ? 1 : 0
  })
}

export function selectTaxLots(input: Readonly<{
  lots: readonly HoldingLot[]
  sellQuantity: Quantity
  salePrice: Money
  asOf: LocalDate
  taxRules: TaxRuleSet
  specificInstructions?: readonly SpecificLotInstruction[]
  mandatoryHardRiskExit: boolean
}>): DomainResult<TaxEstimate> {
  if (input.lots.length > U04_MAX_TAX_LOTS) {
    return failure(domainFailure('CAPACITY_EXCEEDED', { field: 'lots' }))
  }
  if (
    input.taxRules.effectiveFrom > input.asOf
    || !Number.isInteger(input.taxRules.holdingPeriodThresholdDays)
    || input.taxRules.holdingPeriodThresholdDays <= 0
    || input.taxRules.shortTermRatePpm < 0n
    || input.taxRules.longTermRatePpm < 0n
  ) {
    return failure(domainFailure('TAX_RULESET_NOT_EFFECTIVE', { field: 'taxRules' }))
  }
  if (input.lots.reduce((total, lot) => total + lot.openQuantity.shares, 0n)
    < input.sellQuantity.shares) {
    return failure(domainFailure('LOT_LINEAGE_MISSING', { field: 'lots' }))
  }

  let provisional = false
  let selections: readonly SpecificLotInstruction[]
  if (input.taxRules.lotSelectionPolicy === 'SPECIFIC') {
    if (input.specificInstructions === undefined || input.specificInstructions.length === 0) {
      if (!input.mandatoryHardRiskExit) {
        return failure(domainFailure('LOT_SELECTION_INSTRUCTION_MISSING', {
          field: 'specificInstructions',
        }))
      }
      provisional = true
      selections = []
    } else {
      selections = input.specificInstructions
      const seen = new Set<string>()
      if (
        selections.some((selection) => {
          const lot = input.lots.find((value) => value.lotId === selection.lotId)
          const duplicate = seen.has(selection.lotId)
          seen.add(selection.lotId)
          return duplicate
            || lot === undefined
            || selection.quantity.shares <= 0n
            || selection.quantity.shares > lot.openQuantity.shares
        })
        || selections.reduce((total, selection) => total + selection.quantity.shares, 0n)
          !== input.sellQuantity.shares
      ) {
        return failure(domainFailure('LOT_SELECTION_INSTRUCTION_MISSING', {
          field: 'specificInstructions',
        }))
      }
    }
  } else {
    selections = []
  }

  const selected: Array<{ lot: HoldingLot; shares: bigint }> = []
  if (selections.length > 0) {
    for (const selection of selections) {
      const lot = input.lots.find((value) => value.lotId === selection.lotId)
      if (lot !== undefined) selected.push({ lot, shares: selection.quantity.shares })
    }
  } else {
    const policy = input.taxRules.lotSelectionPolicy === 'HIFO' ? 'HIFO' : 'FIFO'
    let remaining = input.sellQuantity.shares
    for (const lot of sortedLots(input.lots, policy)) {
      if (remaining === 0n) break
      const shares = lot.openQuantity.shares < remaining
        ? lot.openQuantity.shares
        : remaining
      selected.push({ lot, shares })
      remaining -= shares
    }
  }

  let taxableGainOrLoss = 0n
  let estimatedTax = 0n
  const dispositions: LotDisposition[] = []
  for (const { lot, shares } of selected) {
    const gain = shares * (input.salePrice.minorUnits - lot.unitCost.minorUnits)
    const holdingDays = epochDay(input.asOf) - epochDay(lot.acquiredOn)
    const termClassification = holdingDays >= input.taxRules.holdingPeriodThresholdDays
      ? 'LONG_TERM' as const
      : 'SHORT_TERM' as const
    const rate = termClassification === 'LONG_TERM'
      ? input.taxRules.longTermRatePpm
      : input.taxRules.shortTermRatePpm
    taxableGainOrLoss += gain
    if (gain > 0n) estimatedTax += gain * rate / U04_RATE_SCALE
    const sellQuantity = createQuantity(shares)
    const estimatedGain = createMoney(gain)
    if (!sellQuantity.ok || !estimatedGain.ok) {
      return failure(domainFailure('HOLDING_PERIOD_CLASSIFICATION_INVALID', {
        field: 'lotDisposition',
      }))
    }
    dispositions.push(Object.freeze({
      lotId: lot.lotId,
      sellQuantity: sellQuantity.value,
      acquiredOn: lot.acquiredOn,
      unitCost: lot.unitCost,
      estimatedGainOrLoss: estimatedGain.value,
      termClassification,
    }))
  }
  const taxableMoney = createMoney(taxableGainOrLoss)
  const taxMoney = createMoney(estimatedTax)
  if (!taxableMoney.ok || !taxMoney.ok) {
    return failure(domainFailure('HOLDING_PERIOD_CLASSIFICATION_INVALID', { field: 'tax' }))
  }
  return success(Object.freeze({
    selectedLots: Object.freeze(dispositions),
    taxableGainOrLoss: taxableMoney.value,
    estimatedTax: taxMoney.value,
    taxRuleVersionId: input.taxRules.taxRuleVersionId,
    isProvisional: provisional,
  }))
}
