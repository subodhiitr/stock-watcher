import type Database from 'better-sqlite3';
import type { ApprovalDecisionSnapshot } from '../../domain/execution/approval.ts';
import type { NormalizedFill } from '../../domain/execution/contracts.ts';
import type { CancellationAttemptRecord, CancellationOutcomeRecord, ExecutionOrderSnapshot } from '../../domain/execution/execution-order.ts';
import type { ExecutionRunSnapshot } from '../../domain/execution/execution-run.ts';
import type { KillSwitchScope, KillSwitchSnapshot } from '../../domain/execution/kill-switch.ts';
import type { ReconciliationRunSnapshot, ReconciliationSnapshotRecord } from '../../domain/execution/reconciliation.ts';
import type { AdjustmentProposal, ResidualWork } from '../../domain/execution/residual-and-adjustment.ts';
import type { AdjustmentProposalId, ApprovalId, BrokerOrderReferenceId, CancellationId, ExecutionRunId, FillId, KillSwitchId, OrderId, PortfolioId, ReconciliationRunId, ReconciliationSnapshotId, ResidualWorkId } from '../../domain/shared/identifiers.ts';
import type { AdjustmentProposalRepository, CancellationFactRepository, ExecutionApprovalRepository, ExecutionOrderRepository, ExecutionRunRepository, FillFactRepository, KillSwitchRepository, ReconciliationRunRepository, ReconciliationSnapshotRepository, ResidualWorkRepository } from '../../ports/execution/execution-unit-of-work.ts';
import { type PersistenceResult } from '../../infrastructure/persistence/failures.ts';
import type { ExecutionAggregateKind, ExecutionFactKind, TransactionMutation } from './unit-of-work.ts';
type PayloadRow = Readonly<{
    canonical_payload: string;
}>;
type MutationRecorder = (mutation: TransactionMutation) => void;
declare abstract class TransactionRepository {
    protected readonly database: Database.Database;
    protected readonly recordMutation: MutationRecorder;
    private readonly canAccess;
    constructor(database: Database.Database, canAccess: () => boolean, recordMutation: MutationRecorder);
    protected accessible(): boolean;
    protected payload(sql: string, ...parameters: readonly unknown[]): PayloadRow | undefined;
    protected payloads(sql: string, ...parameters: readonly unknown[]): readonly PayloadRow[];
    protected recordAggregate(aggregateKind: ExecutionAggregateKind, aggregateId: string, portfolioId: string | undefined, stateVersion: number, kind: 'INSERT' | 'SAVE'): void;
    protected recordFact(factKind: ExecutionFactKind, factId: string, portfolioId: string): void;
}
export declare class SqliteExecutionApprovalRepository extends TransactionRepository implements ExecutionApprovalRepository {
    insert(snapshot: ApprovalDecisionSnapshot): PersistenceResult<void>;
    getById(approvalId: ApprovalId): PersistenceResult<ApprovalDecisionSnapshot | undefined>;
    findActiveByPortfolio(portfolioId: PortfolioId): PersistenceResult<ApprovalDecisionSnapshot | undefined>;
    save(snapshot: ApprovalDecisionSnapshot, expectedStateVersion: number): PersistenceResult<void>;
}
export declare class SqliteExecutionRunRepository extends TransactionRepository implements ExecutionRunRepository {
    insert(snapshot: ExecutionRunSnapshot): PersistenceResult<void>;
    private decode;
    getById(executionRunId: ExecutionRunId): PersistenceResult<ExecutionRunSnapshot | undefined>;
    findActiveByPortfolio(portfolioId: PortfolioId): PersistenceResult<ExecutionRunSnapshot | undefined>;
    findByApprovalId(approvalId: ApprovalId): PersistenceResult<ExecutionRunSnapshot | undefined>;
    listActive(): PersistenceResult<readonly ExecutionRunSnapshot[]>;
    save(snapshot: ExecutionRunSnapshot, expectedStateVersion: number): PersistenceResult<void>;
}
export declare class SqliteExecutionOrderRepository extends TransactionRepository implements ExecutionOrderRepository {
    insert(snapshot: ExecutionOrderSnapshot): PersistenceResult<void>;
    private decode;
    private decodeMany;
    getById(orderId: OrderId): PersistenceResult<ExecutionOrderSnapshot | undefined>;
    listByRun(executionRunId: ExecutionRunId): PersistenceResult<readonly ExecutionOrderSnapshot[]>;
    findByBrokerReference(portfolioId: PortfolioId, brokerOrderReferenceId: BrokerOrderReferenceId): PersistenceResult<ExecutionOrderSnapshot | undefined>;
    listCancellableByScope(scope: KillSwitchScope): PersistenceResult<readonly ExecutionOrderSnapshot[]>;
    save(snapshot: ExecutionOrderSnapshot, expectedStateVersion: number): PersistenceResult<void>;
}
export declare class SqliteReconciliationRunRepository extends TransactionRepository implements ReconciliationRunRepository {
    insert(snapshot: ReconciliationRunSnapshot): PersistenceResult<void>;
    private decode;
    getById(reconciliationRunId: ReconciliationRunId): PersistenceResult<ReconciliationRunSnapshot | undefined>;
    findLatestByPortfolio(portfolioId: PortfolioId): PersistenceResult<ReconciliationRunSnapshot | undefined>;
    save(snapshot: ReconciliationRunSnapshot, expectedStateVersion: number): PersistenceResult<void>;
}
export declare class SqliteReconciliationSnapshotRepository extends TransactionRepository implements ReconciliationSnapshotRepository {
    insert(record: ReconciliationSnapshotRecord): PersistenceResult<void>;
    getById(snapshotId: ReconciliationSnapshotId): PersistenceResult<ReconciliationSnapshotRecord | undefined>;
}
export declare class SqliteKillSwitchRepository extends TransactionRepository implements KillSwitchRepository {
    insert(snapshot: KillSwitchSnapshot): PersistenceResult<void>;
    getById(killSwitchId: KillSwitchId): PersistenceResult<KillSwitchSnapshot | undefined>;
    findByScope(scope: KillSwitchScope): PersistenceResult<KillSwitchSnapshot | undefined>;
    save(snapshot: KillSwitchSnapshot, expectedStateVersion: number): PersistenceResult<void>;
}
export declare class SqliteFillFactRepository extends TransactionRepository implements FillFactRepository {
    insert(fill: NormalizedFill): PersistenceResult<void>;
    getById(fillId: FillId): PersistenceResult<NormalizedFill | undefined>;
}
export declare class SqliteCancellationFactRepository extends TransactionRepository implements CancellationFactRepository {
    private portfolioForOrder;
    insertRequest(record: CancellationAttemptRecord): PersistenceResult<void>;
    getRequestById(cancellationId: CancellationId): PersistenceResult<CancellationAttemptRecord | undefined>;
    findRequestByOrderAndIdempotencyKey(orderId: OrderId, idempotencyKey: CancellationAttemptRecord['idempotencyKey']): PersistenceResult<CancellationAttemptRecord | undefined>;
    insertOutcome(record: CancellationOutcomeRecord): PersistenceResult<void>;
    getOutcomeById(cancellationId: CancellationId): PersistenceResult<CancellationOutcomeRecord | undefined>;
}
export declare class SqliteResidualWorkRepository extends TransactionRepository implements ResidualWorkRepository {
    insert(work: ResidualWork): PersistenceResult<void>;
    getById(residualWorkId: ResidualWorkId): PersistenceResult<ResidualWork | undefined>;
}
export declare class SqliteAdjustmentProposalRepository extends TransactionRepository implements AdjustmentProposalRepository {
    private portfolioForRun;
    insert(proposal: AdjustmentProposal): PersistenceResult<void>;
    getById(adjustmentProposalId: AdjustmentProposalId): PersistenceResult<AdjustmentProposal | undefined>;
    save(proposal: AdjustmentProposal, expectedStateVersion: number): PersistenceResult<void>;
}
export {};
