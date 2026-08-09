import { type ApprovalDecisionSnapshot, type DecisionKind } from '../../domain/execution/approval.ts';
import type { ApprovalBinding, ExecutionMode } from '../../domain/execution/contracts.ts';
import { type AnyDomainFailure, type DomainResult } from '../../domain/errors/result.ts';
import type { IntegrityHash } from '../../domain/portfolio/evidence.ts';
import type { ExecutionUnitOfWork, CommittedExecutionResult } from '../../ports/execution/execution-unit-of-work.ts';
import type { ExecutionStatePort } from '../../ports/execution/execution-state-port.ts';
import type { ExecutionClockPort } from '../../ports/execution/runtime-port.ts';
export type ApprovalDecisionCommand = Readonly<{
    pending: ApprovalDecisionSnapshot;
    binding?: ApprovalBinding;
    decisionKind: DecisionKind;
    reasonCode?: string;
    mandatoryLogicalOrderKeys: readonly IntegrityHash[];
    mode: ExecutionMode;
    timeoutMs: number;
}>;
export declare class ApprovalService {
    private readonly state;
    private readonly unitOfWork;
    private readonly clock;
    constructor(state: ExecutionStatePort, unitOfWork: ExecutionUnitOfWork, clock: ExecutionClockPort);
    decide(command: ApprovalDecisionCommand): Promise<DomainResult<CommittedExecutionResult<ApprovalDecisionSnapshot>, AnyDomainFailure>>;
}
