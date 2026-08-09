import type { AnyDomainFailure } from "../../domain/errors/result.ts";
import { type DomainResult } from "../../domain/errors/result.ts";
import type { BacktestRunId, StrategyVersionId } from "../../domain/shared/identifiers.ts";
import { type BacktestResult, type BacktestRun } from "../../domain/strategy/backtest-run.ts";
import type { BacktestRunRepository } from "../../ports/strategy/backtest-run-repository.ts";
import type { ClockPort } from "../../ports/index.ts";
export declare class BacktestOrchestrationService {
    private readonly backtestRunRepo;
    private readonly clock;
    constructor(backtestRunRepo: BacktestRunRepository, clock: ClockPort);
    startBacktest(params: {
        backtestRunId: BacktestRunId;
        strategyVersionId: StrategyVersionId;
        startDate: string;
        endDate: string;
        randomSeed: number;
        mode: "research";
    }): DomainResult<BacktestRun, AnyDomainFailure>;
    advanceToRunning(backtestRunId: BacktestRunId): DomainResult<BacktestRun, AnyDomainFailure>;
    recordBias(params: {
        backtestRunId: BacktestRunId;
        check: "LOOK_AHEAD" | "SURVIVORSHIP";
        violations: number;
    }): DomainResult<BacktestRun, AnyDomainFailure>;
    completeBacktest(backtestRunId: BacktestRunId, result: BacktestResult): DomainResult<BacktestRun, AnyDomainFailure>;
    failBacktest(backtestRunId: BacktestRunId, reason: string): DomainResult<BacktestRun, AnyDomainFailure>;
}
