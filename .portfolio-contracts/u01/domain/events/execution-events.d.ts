import type { ExecutionEvidencePayload } from '../execution/evidence.ts';
import type { EventId, PortfolioId } from '../shared/identifiers.ts';
import type { Instant } from '../shared/time.ts';
export declare const EXECUTION_EVENT_SCHEMA_VERSION: 1;
export type ExecutionEventAggregateKind = 'PORTFOLIO' | 'APPROVAL' | 'EXECUTION_RUN' | 'EXECUTION_ORDER' | 'RECONCILIATION_RUN' | 'KILL_SWITCH' | 'ADJUSTMENT_PROPOSAL';
export type ExecutionEventFactKind = 'RECONCILIATION_SNAPSHOT' | 'FILL' | 'CANCELLATION_REQUEST' | 'CANCELLATION_OUTCOME' | 'RESIDUAL_WORK';
export type ExecutionEventScope = Readonly<{
    kind: 'PORTFOLIO';
    portfolioId: PortfolioId;
}> | Readonly<{
    kind: 'GLOBAL';
    globalStreamId: 'GLOBAL_EXECUTION_CONTROL';
}>;
type ExecutionEventEnvelope = Readonly<{
    eventId: EventId;
    schemaVersion: typeof EXECUTION_EVENT_SCHEMA_VERSION;
    scope: ExecutionEventScope;
    occurredAt: Instant;
}>;
export type ExecutionAggregateMutationEvent = ExecutionEventEnvelope & Readonly<{
    type: 'ExecutionAggregateMutationRecorded';
    payload: Readonly<{
        operation: 'INSERT' | 'SAVE';
        aggregateKind: ExecutionEventAggregateKind;
        aggregateId: string;
        aggregateStateVersion: number;
        evidence: ExecutionEvidencePayload;
    }>;
}>;
export type ExecutionFactInsertionEvent = ExecutionEventEnvelope & Readonly<{
    type: 'ExecutionFactInserted';
    payload: Readonly<{
        factKind: ExecutionEventFactKind;
        factId: string;
        evidence: ExecutionEvidencePayload;
    }>;
}>;
export type ExecutionDomainEvent = ExecutionAggregateMutationEvent | ExecutionFactInsertionEvent;
export declare function freezeExecutionDomainEvent<T extends ExecutionDomainEvent>(event: T): T;
export {};
