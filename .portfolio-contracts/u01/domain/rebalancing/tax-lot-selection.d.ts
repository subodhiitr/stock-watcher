import type { HoldingLot } from '../portfolio/holding-lot.ts';
import { type DomainResult } from '../errors/result.ts';
import type { HoldingLotId, TaxRuleVersionId } from '../shared/identifiers.ts';
import { type Money } from '../shared/money.ts';
import { type Quantity } from '../shared/quantity.ts';
import type { LocalDate } from '../shared/time.ts';
export type LotSelectionPolicy = 'FIFO' | 'HIFO' | 'SPECIFIC';
export type TaxRuleSet = Readonly<{
    taxRuleVersionId: TaxRuleVersionId;
    effectiveFrom: LocalDate;
    holdingPeriodThresholdDays: number;
    shortTermRatePpm: bigint;
    longTermRatePpm: bigint;
    lotSelectionPolicy: LotSelectionPolicy;
}>;
export type SpecificLotInstruction = Readonly<{
    lotId: HoldingLotId;
    quantity: Quantity;
}>;
export type LotDisposition = Readonly<{
    lotId: HoldingLotId;
    sellQuantity: Quantity;
    acquiredOn: LocalDate;
    unitCost: Money;
    estimatedGainOrLoss: Money;
    termClassification: 'SHORT_TERM' | 'LONG_TERM';
}>;
export type TaxEstimate = Readonly<{
    selectedLots: readonly LotDisposition[];
    taxableGainOrLoss: Money;
    estimatedTax: Money;
    taxRuleVersionId: TaxRuleVersionId;
    isProvisional: boolean;
}>;
export declare function selectTaxLots(input: Readonly<{
    lots: readonly HoldingLot[];
    sellQuantity: Quantity;
    salePrice: Money;
    asOf: LocalDate;
    taxRules: TaxRuleSet;
    specificInstructions?: readonly SpecificLotInstruction[];
    mandatoryHardRiskExit: boolean;
}>): DomainResult<TaxEstimate>;
