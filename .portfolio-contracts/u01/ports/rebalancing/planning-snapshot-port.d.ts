import type { DomainResult } from '../../domain/errors/result.ts';
import type { PortfolioSnapshot } from '../../domain/portfolio/portfolio.ts';
import type { CorporateAction } from '../../domain/strategy/corporate-action.ts';
import type { EligibilityResult } from '../../domain/strategy/eligibility-result.ts';
import type { RegimeState } from '../../domain/strategy/regime-state.ts';
import type { SignalSnapshot } from '../../domain/strategy/signal-snapshot.ts';
import type { StrategyConfig } from '../../domain/strategy/strategy-config.ts';
import type { CalendarSessionId, DataVersionId, PortfolioId, RebalanceRunId, StrategyVersionId } from '../../domain/shared/identifiers.ts';
import type { IntegrityHash } from '../../domain/portfolio/evidence.ts';
import type { Instant, LocalDate } from '../../domain/shared/time.ts';
export type ConfirmedPlanningSession = Readonly<{
    calendarSessionId: CalendarSessionId;
    sessionDate: LocalDate;
    decisionReadyAt: Instant;
    eligibleExecutionDate: LocalDate;
    eligibleExecutionWindowStart: string;
    eligibleExecutionWindowEnd: string;
    timeZone: 'Asia/Kolkata';
    finalized: true;
    sameSessionExecutionAllowed: false;
}>;
export type InstrumentEvaluationSnapshot = Readonly<{
    eligibility: EligibilityResult;
    signal: SignalSnapshot;
    sectorId?: string;
    groupId?: string;
    marketCapBucket?: 'LARGE_CAP' | 'MID_CAP' | 'SMALL_CAP';
    priceMinorUnits: bigint;
    realizedVolatilityPpm: bigint;
    liquidityCapacityMinorUnits: bigint;
}>;
export type PlanningSnapshot = Readonly<{
    portfolio: PortfolioSnapshot;
    strategyVersionId: StrategyVersionId;
    strategyConfigHash: IntegrityHash;
    strategyConfig: StrategyConfig;
    dataVersionId: DataVersionId;
    evaluationAsOf: LocalDate;
    evaluations: readonly InstrumentEvaluationSnapshot[];
    regime: RegimeState;
    corporateActions: readonly CorporateAction[];
    reconciliationSnapshotId: string;
    session: ConfirmedPlanningSession;
}>;
export type PlanningSnapshotRequest = Readonly<{
    portfolioId: PortfolioId;
    rebalanceRunId: RebalanceRunId;
    asOf: LocalDate;
    timeoutMs: number;
}>;
export interface PlanningSnapshotPort {
    loadPlanningSnapshot(request: PlanningSnapshotRequest): Promise<DomainResult<PlanningSnapshot>>;
}
