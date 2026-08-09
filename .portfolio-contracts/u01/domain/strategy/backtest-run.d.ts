import { type DomainResult } from '../errors/result.ts';
import type { BacktestRunId, DataVersionId, StrategyVersionId } from '../shared/identifiers.ts';
export type BacktestStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type WalkForwardFold = Readonly<{
    foldIndex: number;
    inSampleStart: string;
    inSampleEnd: string;
    outOfSampleStart: string;
    outOfSampleEnd: string;
    dataVersionId: DataVersionId;
    keyMetrics: Readonly<Record<string, number>>;
}>;
export type BacktestResult = Readonly<{
    dataVersionId: DataVersionId;
    folds: readonly WalkForwardFold[];
    calendarVersion: string;
    timezone: string;
    randomSeed: number;
    estimatedCostDragBps: number;
    estimatedTaxDragBps: number;
    noReturnGuaranteeStatement: string;
    lookAheadViolations: number;
    survivorshipViolations: number;
    lookAheadChecksPerformed: boolean;
    survivorshipBiasChecksPerformed: boolean;
}>;
export type BacktestRun = Readonly<{
    backtestRunId: BacktestRunId;
    strategyVersionId: StrategyVersionId;
    startDate: string;
    endDate: string;
    status: BacktestStatus;
    lookAheadViolations: number;
    survivorshipViolations: number;
    lookAheadChecksPerformed: boolean;
    survivorshipBiasChecksPerformed: boolean;
    result: BacktestResult | null;
    randomSeed: number;
    createdAt: string;
    updatedAt: string;
}>;
export declare function createBacktestRun(params: {
    backtestRunId: BacktestRunId;
    strategyVersionId: StrategyVersionId;
    startDate: string;
    endDate: string;
    randomSeed: number;
    createdAt: string;
}): DomainResult<BacktestRun>;
export declare function startBacktestRun(run: BacktestRun, updatedAt: string): DomainResult<BacktestRun>;
export declare function recordBiasCheck(run: BacktestRun, check: 'LOOK_AHEAD' | 'SURVIVORSHIP', violations: number, updatedAt: string): DomainResult<BacktestRun>;
export declare function completeBacktestRun(run: BacktestRun, result: BacktestResult, updatedAt: string): DomainResult<BacktestRun>;
export declare function failBacktestRun(run: BacktestRun, reason: string, updatedAt: string): DomainResult<BacktestRun>;
export declare const BACKTEST_CONSTANTS: Readonly<{
    MIN_BACKTEST_YEARS: 5;
    MIN_TRADING_DAYS_PER_YEAR: 252;
    MIN_WALKFORWARD_FOLDS: 3;
    DATA_COMPLETENESS_THRESHOLD_PCT: 98;
}>;
