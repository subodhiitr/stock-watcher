import { type KillSwitchActivation, type KillSwitchReset, type KillSwitchScope, type KillSwitchSnapshot } from '../../domain/execution/kill-switch.ts';
import type { ExecutionOrderSnapshot } from '../../domain/execution/execution-order.ts';
import { type AnyDomainFailure, type DomainResult } from '../../domain/errors/result.ts';
import type { CommittedExecutionResult, ExecutionUnitOfWork, KillSwitchResetEligibilityToken } from '../../ports/execution/execution-unit-of-work.ts';
import type { ExecutionClockPort } from '../../ports/execution/runtime-port.ts';
import { CancellationCoordinator, type CancelOrderCommand } from './cancellation-coordinator.ts';
import type { ExecutionDispatchFence, UnresolvedDispatchAdmission } from './placement-coordinator.ts';
export type ActivateKillSwitchCommand = Readonly<{
    snapshot: KillSwitchSnapshot;
    activation: KillSwitchActivation;
}>;
export type ResetKillSwitchCommand = Readonly<{
    snapshot: KillSwitchSnapshot;
    reset: Omit<KillSwitchReset, 'healthSnapshotHash' | 'reconciliationSnapshotIds'>;
}>;
export interface KillSwitchResetEligibilityPort {
    assess(scope: KillSwitchScope, asOf: KillSwitchReset['resetAt']): Promise<DomainResult<KillSwitchResetEligibilityToken>>;
}
export interface CancellationCommandFactory {
    create(order: ExecutionOrderSnapshot, killSwitch: KillSwitchSnapshot): DomainResult<CancelOrderCommand>;
}
export interface UnresolvedDispatchContainment {
    containAndRequireReconciliation(unresolved: UnresolvedDispatchAdmission, killSwitch: KillSwitchSnapshot): Promise<DomainResult<void, AnyDomainFailure>>;
}
export type KillSwitchActivationResult = Readonly<{
    snapshot: KillSwitchSnapshot;
    cancellationCoverageComplete: boolean;
    unresolvedAdmissions: readonly UnresolvedDispatchAdmission[];
}>;
export declare class KillSwitchService {
    private readonly unitOfWork;
    private readonly cancellations;
    private readonly clock;
    private readonly resetEligibility;
    private readonly cancellationCommands;
    private readonly dispatchFence;
    private readonly unresolvedContainment;
    constructor(unitOfWork: ExecutionUnitOfWork, cancellations: CancellationCoordinator, clock: ExecutionClockPort, resetEligibility: KillSwitchResetEligibilityPort, cancellationCommands: CancellationCommandFactory, dispatchFence: ExecutionDispatchFence, unresolvedContainment: UnresolvedDispatchContainment);
    activate(command: ActivateKillSwitchCommand): Promise<DomainResult<CommittedExecutionResult<KillSwitchActivationResult>, AnyDomainFailure>>;
    reset(command: ResetKillSwitchCommand): Promise<DomainResult<CommittedExecutionResult<KillSwitchSnapshot>, AnyDomainFailure>>;
}
