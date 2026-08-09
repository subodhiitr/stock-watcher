import type { ConstructionConstraintSet, PlanningCandidate, PlanningTiming } from '../../domain/construction/planning-context.ts';
import type { IntegrityHash } from '../../domain/portfolio/evidence.ts';
import type { PortfolioId } from '../../domain/shared/identifiers.ts';
import type { Money } from '../../domain/shared/money.ts';
import type { ExecutableTarget } from '../../domain/rebalancing/whole-share-greedy-allocator.ts';
import type { OptimizerMode, OptimizerPort } from '../../ports/rebalancing/optimizer-port.ts';
export type OptimizerOutcomeStatus = 'VERIFIED_ACCEPTED' | 'TIMEOUT' | 'INFEASIBLE' | 'SOLVER_ERROR' | 'VERIFICATION_REJECTED' | 'FALLBACK_USED';
export type OptimizerOutcome = Readonly<{
    status: OptimizerOutcomeStatus;
    mode: OptimizerMode;
    requestHash: IntegrityHash;
    timeoutBudgetMs: number;
    durationMs: number;
    iterationCount: number;
    verifierAccepted: boolean;
    violatedConstraintIds: readonly string[];
    fallbackReason?: 'TIMEOUT' | 'INFEASIBLE' | 'SOLVER_ERROR' | 'VERIFICATION_REJECTED';
}>;
export type OptimizerOrchestrationResult = Readonly<{
    executableTarget: ExecutableTarget;
    optimizerOutcome: OptimizerOutcome;
}>;
export declare class OptimizerOrchestrationService {
    #private;
    constructor(optimizer: OptimizerPort);
    optimize(input: Readonly<{
        portfolioId: PortfolioId;
        mode: OptimizerMode;
        timeoutBudgetMs: number;
        greedyTarget: ExecutableTarget;
        idealWeights: ReadonlyMap<string, bigint>;
        candidates: readonly PlanningCandidate[];
        startingNav: Money;
        constraints: ConstructionConstraintSet;
        timing: PlanningTiming;
    }>): Promise<OptimizerOrchestrationResult>;
}
