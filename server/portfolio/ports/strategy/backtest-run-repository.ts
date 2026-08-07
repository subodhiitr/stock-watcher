import type { AnyDomainFailure, DomainResult } from '../../domain/errors/result.ts'
import type { BacktestRunId, StrategyVersionId } from '../../domain/shared/identifiers.ts'
import type { BacktestRun } from '../../domain/strategy/backtest-run.ts'

export interface BacktestRunRepository {
  insert(run: BacktestRun): DomainResult<void, AnyDomainFailure>
  getById(backtestRunId: BacktestRunId): DomainResult<BacktestRun | undefined, AnyDomainFailure>
  listByStrategyVersionId(strategyVersionId: StrategyVersionId): DomainResult<readonly BacktestRun[], AnyDomainFailure>
  save(run: BacktestRun): DomainResult<void, AnyDomainFailure>
}
