import { type DomainResult } from '../../domain/errors/result.ts';
import { type PlanningPhaseDuration } from '../../domain/shared/safe-observability-payload-builder.ts';
import { type RebalancePlan } from '../../domain/rebalancing/rebalance-plan.ts';
import type { OptimizerMode } from '../../ports/rebalancing/optimizer-port.ts';
import { PlanningSnapshotAssembler, type PlanningAssemblyRequest } from './planning-snapshot-assembler.ts';
import { OptimizerOrchestrationService } from './optimizer-orchestration-service.ts';
export type RebalancePlanningRequest = Readonly<{
    assembly: PlanningAssemblyRequest;
    optimizerMode?: OptimizerMode;
    optimizerTimeoutMs?: number;
    phaseDurations: readonly PlanningPhaseDuration[];
}>;
export declare class RebalancePlanningService {
    #private;
    constructor(input: Readonly<{
        assembler: PlanningSnapshotAssembler;
        optimizer?: OptimizerOrchestrationService;
    }>);
    plan(request: RebalancePlanningRequest): Promise<DomainResult<RebalancePlan>>;
}
