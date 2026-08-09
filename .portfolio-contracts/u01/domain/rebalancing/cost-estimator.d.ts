import { type DomainResult } from '../errors/result.ts';
import type { CostScheduleVersionId } from '../shared/identifiers.ts';
import { type Money } from '../shared/money.ts';
import type { LocalDate } from '../shared/time.ts';
export type CostChargeCode = 'BROKERAGE' | 'STT' | 'EXCHANGE' | 'GST' | 'SEBI' | 'STAMP_DUTY' | 'DP' | 'BROKER_FEE';
export type CostChargeRule = Readonly<{
    chargeCode: CostChargeCode;
    appliesToSide: 'BUY' | 'SELL' | 'BOTH';
    ratePpm: bigint;
    fixedMinorUnits: bigint;
}>;
export type CostSchedule = Readonly<{
    scheduleVersionId: CostScheduleVersionId;
    effectiveFrom: LocalDate;
    chargeRules: readonly CostChargeRule[];
    spreadRatePpm: bigint;
    slippageRatePpm: bigint;
    impactRatePpm: bigint;
}>;
export type CostEstimate = Readonly<{
    scheduleVersionId: CostScheduleVersionId;
    grossNotional: Money;
    brokerage: Money;
    stt: Money;
    exchangeCharges: Money;
    gst: Money;
    sebiCharges: Money;
    stampDuty: Money;
    dpCharges: Money;
    spreadCost: Money;
    slippageCost: Money;
    impactCost: Money;
    brokerFees: Money;
    statutoryCharges: Money;
    totalCost: Money;
}>;
export declare function estimateOrderCost(input: Readonly<{
    schedule: CostSchedule;
    asOf: LocalDate;
    side: 'BUY' | 'SELL';
    grossNotional: Money;
}>): DomainResult<CostEstimate>;
