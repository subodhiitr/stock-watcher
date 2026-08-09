export type PortfolioLotGroup = Readonly<{
  key: string
  instrumentId: string
  acquiredOn: string
  openQuantity: bigint
  unitCostMinorUnits: string
  sourceKind: string
  lotCount: number
  lotIds: readonly string[]
  sourceReferenceIds: readonly string[]
}>

export function groupPortfolioLots(
  lots: readonly Readonly<Record<string, string | number>>[],
): readonly PortfolioLotGroup[] {
  const groups = new Map<string, {
    instrumentId: string
    acquiredOn: string
    openQuantity: bigint
    unitCostMinorUnits: string
    sourceKind: string
    lotIds: string[]
    sourceReferenceIds: string[]
  }>()

  for (const lot of lots) {
    const instrumentId = String(lot.instrument_id)
    const acquiredOn = String(lot.acquired_on)
    const unitCostMinorUnits = String(lot.unit_cost_minor_units)
    const sourceKind = String(lot.source_kind)
    const key = [instrumentId, acquiredOn, unitCostMinorUnits, sourceKind].join('\u0000')
    const current = groups.get(key) ?? {
      instrumentId,
      acquiredOn,
      openQuantity: 0n,
      unitCostMinorUnits,
      sourceKind,
      lotIds: [],
      sourceReferenceIds: [],
    }
    current.openQuantity += BigInt(String(lot.open_quantity))
    current.lotIds.push(String(lot.lot_id))
    if (lot.source_reference_id !== undefined) {
      current.sourceReferenceIds.push(String(lot.source_reference_id))
    }
    groups.set(key, current)
  }

  return Object.freeze([...groups.entries()].map(([key, group]) => Object.freeze({
    key,
    instrumentId: group.instrumentId,
    acquiredOn: group.acquiredOn,
    openQuantity: group.openQuantity,
    unitCostMinorUnits: group.unitCostMinorUnits,
    sourceKind: group.sourceKind,
    lotCount: group.lotIds.length,
    lotIds: Object.freeze(group.lotIds),
    sourceReferenceIds: Object.freeze(group.sourceReferenceIds),
  })))
}
