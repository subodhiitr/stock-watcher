import { type DomainResult } from '../errors/result.ts';
import type { DataVersionId } from '../shared/identifiers.ts';
export type RegimeCategory = 'RISK_ON' | 'CAUTION' | 'RISK_OFF' | 'CRISIS';
export type RegimeConfirmationStatus = 'UNCONFIRMED' | 'CONFIRMING' | 'CONFIRMED';
export type RegimeIndicators = Readonly<{
    nifty50AboveDMA200: boolean | null;
    nifty500AboveDMA200: boolean | null;
    breadthAbove200DMA_pct: number | null;
    breadthAbove100DMA_pct: number | null;
    benchmarkVolatility20D: number | null;
    marketDrawdownFrom52W: number | null;
    creditStressProxy: number | null;
}>;
export type RegimeState = Readonly<{
    category: RegimeCategory;
    confirmationStatus: RegimeConfirmationStatus;
    confirmationCount: number;
    indicators: RegimeIndicators;
    dataVersionId: DataVersionId;
    asOf: string;
    isCrisisImmediate: boolean;
    crisisReason: string | null;
    equityExposureMinPct: number;
    equityExposureMaxPct: number;
    evaluatedAt: string;
}>;
export declare function createRegimeState(params: {
    indicators: RegimeIndicators;
    dataVersionId: DataVersionId;
    asOf: string;
    evaluatedAt: string;
    previousRegime?: RegimeCategory;
    previousConfirmationCount?: number;
    crisisDrawdownPct: number;
    highVolatilityThreshold: number;
    confirmationPeriodsWeakening?: number;
    confirmationPeriodsStrengthening?: number;
}): DomainResult<RegimeState>;
export declare function isFailClosedTowardsCrisis(state: RegimeState): boolean;
