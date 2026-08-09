import type { AnyDomainFailure } from "../../domain/errors/result.ts"
import { domainFailure } from "../../domain/errors/failure.ts"
import { failure, success, type DomainResult } from "../../domain/errors/result.ts"
import type { BacktestRunId, StrategyVersionId } from "../../domain/shared/identifiers.ts"
import {
  completeBacktestRun,
  createBacktestRun,
  failBacktestRun,
  recordBiasCheck,
  startBacktestRun,
  type BacktestResult,
  type BacktestRun,
} from "../../domain/strategy/backtest-run.ts"
import type { BacktestRunRepository } from "../../ports/strategy/backtest-run-repository.ts"
import type { ClockPort } from "../../ports/index.ts"

export class BacktestOrchestrationService {
  private readonly backtestRunRepo: BacktestRunRepository
  private readonly clock: ClockPort

  constructor(backtestRunRepo: BacktestRunRepository, clock: ClockPort) {
    this.backtestRunRepo = backtestRunRepo
    this.clock = clock
  }

  startBacktest(params: {
    backtestRunId: BacktestRunId
    strategyVersionId: StrategyVersionId
    startDate: string
    endDate: string
    randomSeed: number
    mode: "research"
  }): DomainResult<BacktestRun, AnyDomainFailure> {
    if (params.mode !== "research") {
      return failure(domainFailure("NON_PRODUCTION_DATA_FOR_PRODUCTION_EVAL", { field: "mode" }))
    }
    const createResult = createBacktestRun({
      backtestRunId: params.backtestRunId,
      strategyVersionId: params.strategyVersionId,
      startDate: params.startDate,
      endDate: params.endDate,
      randomSeed: params.randomSeed,
      createdAt: this.clock.now(),
    })
    if (!createResult.ok) return createResult

    const insertResult = this.backtestRunRepo.insert(createResult.value)
    if (!insertResult.ok) return insertResult

    return success(createResult.value)
  }

  advanceToRunning(backtestRunId: BacktestRunId): DomainResult<BacktestRun, AnyDomainFailure> {
    const loadResult = this.backtestRunRepo.getById(backtestRunId)
    if (!loadResult.ok) return loadResult
    const run = loadResult.value
    if (!run) return failure(domainFailure("STRATEGY_VERSION_NOT_FOUND", { field: "backtestRunId" }))

    const startedResult = startBacktestRun(run, this.clock.now())
    if (!startedResult.ok) return startedResult

    const saveResult = this.backtestRunRepo.save(startedResult.value)
    if (!saveResult.ok) return saveResult

    return success(startedResult.value)
  }

  recordBias(params: {
    backtestRunId: BacktestRunId
    check: "LOOK_AHEAD" | "SURVIVORSHIP"
    violations: number
  }): DomainResult<BacktestRun, AnyDomainFailure> {
    const loadResult = this.backtestRunRepo.getById(params.backtestRunId)
    if (!loadResult.ok) return loadResult
    const run = loadResult.value
    if (!run) return failure(domainFailure("STRATEGY_VERSION_NOT_FOUND", { field: "backtestRunId" }))

    const updated = recordBiasCheck(run, params.check, params.violations, this.clock.now())
    if (!updated.ok) return updated

    const saveResult = this.backtestRunRepo.save(updated.value)
    if (!saveResult.ok) return saveResult

    return success(updated.value)
  }

  completeBacktest(backtestRunId: BacktestRunId, result: BacktestResult): DomainResult<BacktestRun, AnyDomainFailure> {
    const loadResult = this.backtestRunRepo.getById(backtestRunId)
    if (!loadResult.ok) return loadResult
    const run = loadResult.value
    if (!run) return failure(domainFailure("STRATEGY_VERSION_NOT_FOUND", { field: "backtestRunId" }))

    const completedResult = completeBacktestRun(run, result, this.clock.now())
    if (!completedResult.ok) return completedResult

    const saveResult = this.backtestRunRepo.save(completedResult.value)
    if (!saveResult.ok) return saveResult

    return success(completedResult.value)
  }

  failBacktest(backtestRunId: BacktestRunId, reason: string): DomainResult<BacktestRun, AnyDomainFailure> {
    const loadResult = this.backtestRunRepo.getById(backtestRunId)
    if (!loadResult.ok) return loadResult
    const run = loadResult.value
    if (!run) return failure(domainFailure("STRATEGY_VERSION_NOT_FOUND", { field: "backtestRunId" }))

    const failed = failBacktestRun(run, reason, this.clock.now())
    if (!failed.ok) return failed

    const saveResult = this.backtestRunRepo.save(failed.value)
    if (!saveResult.ok) return saveResult

    return success(failed.value)
  }
}
