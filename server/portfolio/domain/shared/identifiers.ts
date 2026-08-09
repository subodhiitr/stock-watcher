import { MAX_IDENTIFIER_LENGTH } from './constants.ts'
import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'

declare const identifierBrand: unique symbol

export type BrandedIdentifier<Kind extends string> = string & {
  readonly [identifierBrand]: Kind
}

export type PortfolioId = BrandedIdentifier<'PortfolioId'>
export type HoldingId = BrandedIdentifier<'HoldingId'>
export type HoldingLotId = BrandedIdentifier<'HoldingLotId'>
export type InstrumentId = BrandedIdentifier<'InstrumentId'>
export type StrategyId = BrandedIdentifier<'StrategyId'>
export type StrategyVersionId = BrandedIdentifier<'StrategyVersionId'>
export type StrategyAssignmentId = BrandedIdentifier<'StrategyAssignmentId'>
export type StrategySleeveId = BrandedIdentifier<'StrategySleeveId'>
export type RebalanceRunId = BrandedIdentifier<'RebalanceRunId'>
export type OrderId = BrandedIdentifier<'OrderId'>
export type ActorId = BrandedIdentifier<'ActorId'>
export type CommandId = BrandedIdentifier<'CommandId'>
export type EventId = BrandedIdentifier<'EventId'>
export type CorrelationId = BrandedIdentifier<'CorrelationId'>
export type CausationId = BrandedIdentifier<'CausationId'>
export type IdempotencyKey = BrandedIdentifier<'IdempotencyKey'>
export type EvidenceId = BrandedIdentifier<'EvidenceId'>
export type AllocationId = BrandedIdentifier<'AllocationId'>

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

function parseIdentifier<Kind extends string>(
  kind: Kind,
  value: unknown,
): DomainResult<BrandedIdentifier<Kind>> {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_IDENTIFIER_LENGTH
    || value.trim() !== value
    || !IDENTIFIER_PATTERN.test(value)
  ) {
    return failure(domainFailure('INVALID_IDENTIFIER', {
      field: kind,
      context: { identifierKind: kind },
    }))
  }
  return success(value as BrandedIdentifier<Kind>)
}

export const parsePortfolioId = (value: unknown): DomainResult<PortfolioId> =>
  parseIdentifier('PortfolioId', value)
export const parseHoldingId = (value: unknown): DomainResult<HoldingId> =>
  parseIdentifier('HoldingId', value)
export const parseHoldingLotId = (value: unknown): DomainResult<HoldingLotId> =>
  parseIdentifier('HoldingLotId', value)
export const parseInstrumentId = (value: unknown): DomainResult<InstrumentId> =>
  parseIdentifier('InstrumentId', value)
export const parseStrategyId = (value: unknown): DomainResult<StrategyId> =>
  parseIdentifier('StrategyId', value)
export const parseStrategyVersionId = (value: unknown): DomainResult<StrategyVersionId> =>
  parseIdentifier('StrategyVersionId', value)
export const parseStrategyAssignmentId = (value: unknown): DomainResult<StrategyAssignmentId> =>
  parseIdentifier('StrategyAssignmentId', value)
export const parseStrategySleeveId = (value: unknown): DomainResult<StrategySleeveId> =>
  parseIdentifier('StrategySleeveId', value)
export const parseRebalanceRunId = (value: unknown): DomainResult<RebalanceRunId> =>
  parseIdentifier('RebalanceRunId', value)
export const parseOrderId = (value: unknown): DomainResult<OrderId> =>
  parseIdentifier('OrderId', value)
export const parseActorId = (value: unknown): DomainResult<ActorId> =>
  parseIdentifier('ActorId', value)
export const parseCommandId = (value: unknown): DomainResult<CommandId> =>
  parseIdentifier('CommandId', value)
export const parseEventId = (value: unknown): DomainResult<EventId> =>
  parseIdentifier('EventId', value)
export const parseCorrelationId = (value: unknown): DomainResult<CorrelationId> =>
  parseIdentifier('CorrelationId', value)
export const parseCausationId = (value: unknown): DomainResult<CausationId> =>
  parseIdentifier('CausationId', value)
export const parseIdempotencyKey = (value: unknown): DomainResult<IdempotencyKey> =>
  parseIdentifier('IdempotencyKey', value)
export const parseEvidenceId = (value: unknown): DomainResult<EvidenceId> =>
  parseIdentifier('EvidenceId', value)
export const parseAllocationId = (value: unknown): DomainResult<AllocationId> =>
  parseIdentifier('AllocationId', value)

export type BacktestRunId = BrandedIdentifier<'BacktestRunId'>
export type DataVersionId = BrandedIdentifier<'DataVersionId'>
export type DataRecordId = BrandedIdentifier<'DataRecordId'>
export type CorporateActionId = BrandedIdentifier<'CorporateActionId'>
export type StrategyVersionEventId = BrandedIdentifier<'StrategyVersionEventId'>
export type CostScheduleVersionId = BrandedIdentifier<'CostScheduleVersionId'>
export type TaxRuleVersionId = BrandedIdentifier<'TaxRuleVersionId'>
export type TurnoverSnapshotId = BrandedIdentifier<'TurnoverSnapshotId'>
export type CalendarSessionId = BrandedIdentifier<'CalendarSessionId'>
export type ApprovalId = BrandedIdentifier<'ApprovalId'>
export type ExecutionRunId = BrandedIdentifier<'ExecutionRunId'>
export type SubmissionAttemptId = BrandedIdentifier<'SubmissionAttemptId'>
export type BrokerAccountBindingId = BrandedIdentifier<'BrokerAccountBindingId'>
export type BrokerOrderReferenceId = BrandedIdentifier<'BrokerOrderReferenceId'>
export type FillId = BrandedIdentifier<'FillId'>
export type CancellationId = BrandedIdentifier<'CancellationId'>
export type ReconciliationRunId = BrandedIdentifier<'ReconciliationRunId'>
export type ReconciliationSnapshotId = BrandedIdentifier<'ReconciliationSnapshotId'>
export type ResidualWorkId = BrandedIdentifier<'ResidualWorkId'>
export type KillSwitchId = BrandedIdentifier<'KillSwitchId'>
export type AdjustmentProposalId = BrandedIdentifier<'AdjustmentProposalId'>
export type QuoteSnapshotId = BrandedIdentifier<'QuoteSnapshotId'>
export type ExecutionPolicySnapshotId = BrandedIdentifier<'ExecutionPolicySnapshotId'>

export const parseBacktestRunId = (value: unknown): DomainResult<BacktestRunId> =>
  parseIdentifier('BacktestRunId', value)
export const parseDataVersionId = (value: unknown): DomainResult<DataVersionId> =>
  parseIdentifier('DataVersionId', value)
export const parseDataRecordId = (value: unknown): DomainResult<DataRecordId> =>
  parseIdentifier('DataRecordId', value)
export const parseCorporateActionId = (value: unknown): DomainResult<CorporateActionId> =>
  parseIdentifier('CorporateActionId', value)
export const parseStrategyVersionEventId = (value: unknown): DomainResult<StrategyVersionEventId> =>
  parseIdentifier('StrategyVersionEventId', value)
export const parseCostScheduleVersionId = (value: unknown): DomainResult<CostScheduleVersionId> =>
  parseIdentifier('CostScheduleVersionId', value)
export const parseTaxRuleVersionId = (value: unknown): DomainResult<TaxRuleVersionId> =>
  parseIdentifier('TaxRuleVersionId', value)
export const parseTurnoverSnapshotId = (value: unknown): DomainResult<TurnoverSnapshotId> =>
  parseIdentifier('TurnoverSnapshotId', value)
export const parseCalendarSessionId = (value: unknown): DomainResult<CalendarSessionId> =>
  parseIdentifier('CalendarSessionId', value)
export const parseApprovalId = (value: unknown): DomainResult<ApprovalId> =>
  parseIdentifier('ApprovalId', value)
export const parseExecutionRunId = (value: unknown): DomainResult<ExecutionRunId> =>
  parseIdentifier('ExecutionRunId', value)
export const parseSubmissionAttemptId = (value: unknown): DomainResult<SubmissionAttemptId> =>
  parseIdentifier('SubmissionAttemptId', value)
export const parseBrokerAccountBindingId = (value: unknown): DomainResult<BrokerAccountBindingId> =>
  parseIdentifier('BrokerAccountBindingId', value)
export const parseBrokerOrderReferenceId = (value: unknown): DomainResult<BrokerOrderReferenceId> =>
  parseIdentifier('BrokerOrderReferenceId', value)
export const parseFillId = (value: unknown): DomainResult<FillId> =>
  parseIdentifier('FillId', value)
export const parseCancellationId = (value: unknown): DomainResult<CancellationId> =>
  parseIdentifier('CancellationId', value)
export const parseReconciliationRunId = (value: unknown): DomainResult<ReconciliationRunId> =>
  parseIdentifier('ReconciliationRunId', value)
export const parseReconciliationSnapshotId = (
  value: unknown,
): DomainResult<ReconciliationSnapshotId> =>
  parseIdentifier('ReconciliationSnapshotId', value)
export const parseResidualWorkId = (value: unknown): DomainResult<ResidualWorkId> =>
  parseIdentifier('ResidualWorkId', value)
export const parseKillSwitchId = (value: unknown): DomainResult<KillSwitchId> =>
  parseIdentifier('KillSwitchId', value)
export const parseAdjustmentProposalId = (value: unknown): DomainResult<AdjustmentProposalId> =>
  parseIdentifier('AdjustmentProposalId', value)
export const parseQuoteSnapshotId = (value: unknown): DomainResult<QuoteSnapshotId> =>
  parseIdentifier('QuoteSnapshotId', value)
export const parseExecutionPolicySnapshotId = (
  value: unknown,
): DomainResult<ExecutionPolicySnapshotId> =>
  parseIdentifier('ExecutionPolicySnapshotId', value)

export function compareIdentifiers(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function redactIdentifier(value: string): string {
  const suffix = value.slice(-6)
  return `...${suffix}`
}
