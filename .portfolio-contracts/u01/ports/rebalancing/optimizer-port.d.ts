import type { DomainResult } from '../../domain/errors/result.ts';
import type { IntegrityHash } from '../../domain/portfolio/evidence.ts';
import type { InstrumentId, PortfolioId } from '../../domain/shared/identifiers.ts';
import type { Money } from '../../domain/shared/money.ts';
import type { Quantity } from '../../domain/shared/quantity.ts';
import type { RebalancingConstraintId } from '../../domain/shared/rebalancing-reasons.ts';
import type { Weight } from '../../domain/shared/weight.ts';
export type OptimizerMode = 'INTEGER_TRACKING' | 'RISK_PARITY';
export type OptimizerCandidate = Readonly<{
    instrumentId: InstrumentId;
    price: Money;
    currentQuantity: Quantity;
    idealWeight: Weight;
    maximumQuantity: Quantity;
}>;
export type OptimizerHardConstraint = Readonly<{
    constraintId: RebalancingConstraintId;
    limitMinorUnits?: bigint;
    limitPartsPerMillion?: bigint;
}>;
export type OptimizerRequest = Readonly<{
    portfolioId: PortfolioId;
    mode: OptimizerMode;
    requestHash: IntegrityHash;
    candidateSetHash: IntegrityHash;
    availableCash: Money;
    candidates: readonly OptimizerCandidate[];
    hardConstraints: readonly OptimizerHardConstraint[];
    turnoverWindowCount: number;
    timeoutBudgetMs: number;
    objective: Readonly<{
        kind: 'MINIMIZE_TRACKING_ERROR' | 'MINIMIZE_RISK_CONTRIBUTION_GAP';
        tolerancePpm: bigint;
    }>;
}>;
export type OptimizerResponseStatus = 'CANDIDATE' | 'TIMEOUT' | 'INFEASIBLE' | 'SOLVER_ERROR';
export type OptimizerPosition = Readonly<{
    instrumentId: InstrumentId;
    targetQuantity: Quantity;
}>;
export type OptimizerResponse = Readonly<{
    status: OptimizerResponseStatus;
    requestHash: IntegrityHash;
    positions: readonly OptimizerPosition[];
    residualCash: Money;
    durationMs: number;
    iterationCount: number;
    violatedConstraintIds: readonly RebalancingConstraintId[];
    objectiveValuePpm?: bigint;
}>;
export interface OptimizerPort {
    optimize(request: OptimizerRequest): Promise<DomainResult<OptimizerResponse>>;
}
