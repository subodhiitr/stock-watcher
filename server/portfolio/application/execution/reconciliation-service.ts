import type { NormalizedFill } from '../../domain/execution/contracts.ts'
import type { BrokerOrderStatus } from '../../domain/execution/contracts.ts'
import type {
  ExecutionRunPortfolioVersionEvidencePayload,
  PortfolioAccountingEvidencePayload,
} from '../../domain/execution/evidence.ts'
import {
  resolveFromUnknown,
  type ExecutionOrderSnapshot,
} from '../../domain/execution/execution-order.ts'
import {
  deriveReconciliationResult,
  isTerminalReconciliationState,
  transitionReconciliationState,
  verifySnapshotCoherence,
  type ReconciliationDifference,
  type ReconciliationRunSnapshot,
  type ReconciliationSnapshotRecord,
} from '../../domain/execution/reconciliation.ts'
import { domainFailure } from '../../domain/errors/failure.ts'
import {
  failure,
  success,
  type AnyDomainFailure,
  type DomainResult,
} from '../../domain/errors/result.ts'
import type {
  BrokerAccountBindingId,
  OrderId,
  PortfolioId,
  ReconciliationRunId,
} from '../../domain/shared/identifiers.ts'
import type { Instant } from '../../domain/shared/time.ts'
import type { BrokerRecoveryCapability } from '../../ports/execution/broker-port.ts'
import type {
  CommittedExecutionResult,
  ExecutionUnitOfWork,
} from '../../ports/execution/execution-unit-of-work.ts'
import type {
  ExecutionClockPort,
  MonotonicTimePort,
} from '../../ports/execution/runtime-port.ts'
import type { ExecutionEvidencePayload } from '../../domain/execution/evidence.ts'
import {
  validateTerminalReservationRelease,
  type TerminalReservationRelease,
} from './placement-coordinator.ts'

export interface ReconciliationComparator {
  compare(
    local: ReconciliationSnapshotRecord,
    external: ReconciliationSnapshotRecord,
  ): DomainResult<readonly ReconciliationDifference[]>
}

export interface MissingFillApplier {
  apply(fill: NormalizedFill): Promise<DomainResult<void>>
}

export type ReconcileCommand = Readonly<{
  run: ReconciliationRunSnapshot
  localSnapshot: ReconciliationSnapshotRecord
  portfolioId: PortfolioId
  accountBindingId: BrokerAccountBindingId
  externalSnapshotId: ReconciliationSnapshotRecord['snapshotId']
  mappingSnapshotHash: ReconciliationSnapshotRecord['contentHash']
  deadlineAt: Instant
  totalDeadlineMs: number
  fromCursor?: string
}>

type StartedReconciliation = Readonly<{
  run: ReconciliationRunSnapshot
  localSnapshot: ReconciliationSnapshotRecord
  externalSnapshot?: ReconciliationSnapshotRecord
}>

export class ReconciliationService {
  private readonly unitOfWork: ExecutionUnitOfWork
  private readonly broker: BrokerRecoveryCapability
  private readonly comparator: ReconciliationComparator
  private readonly missingFillApplier: MissingFillApplier
  private readonly clock: ExecutionClockPort
  private readonly monotonic: MonotonicTimePort
  private readonly terminalRelease: TerminalReservationRelease

  public constructor(
    unitOfWork: ExecutionUnitOfWork,
    broker: BrokerRecoveryCapability,
    comparator: ReconciliationComparator,
    missingFillApplier: MissingFillApplier,
    clock: ExecutionClockPort,
    monotonic: MonotonicTimePort,
    terminalRelease: TerminalReservationRelease,
  ) {
    this.unitOfWork = unitOfWork
    this.broker = broker
    this.comparator = comparator
    this.missingFillApplier = missingFillApplier
    this.clock = clock
    this.monotonic = monotonic
    this.terminalRelease = terminalRelease
  }

  public async reconcile(
    command: ReconcileCommand,
  ): Promise<DomainResult<CommittedExecutionResult<ReconciliationRunSnapshot>, AnyDomainFailure>> {
    if (
      command.run.portfolioId !== command.portfolioId
      || command.localSnapshot.portfolioId !== command.portfolioId
      || command.localSnapshot.source !== 'LOCAL'
      || command.run.localSnapshotId !== command.localSnapshot.snapshotId
      || command.totalDeadlineMs <= 0
      || command.totalDeadlineMs > 120_000
    ) {
      return failure(domainFailure('RECONCILIATION_STATE_INVALID', {
        field: 'command',
        retryability: 'NEVER',
      }))
    }
    const startedMs = this.monotonic.nowMs()
    const startCommit = this.startOrResume(command)
    if (!startCommit.ok) return startCommit
    let current = startCommit.value.value.run
    if (isTerminalReconciliationState(current.state)) {
      return success(Object.freeze({
        value: current,
        postCommitEvidence: startCommit.value.postCommitEvidence,
      }))
    }

    let external = startCommit.value.value.externalSnapshot
    if (current.state === 'COLLECTING' && external === undefined) {
      const collected = await this.broker.collectReconciliationSnapshot({
        snapshotId: command.externalSnapshotId,
        portfolioId: command.portfolioId,
        accountBindingId: command.accountBindingId,
        ...(command.fromCursor !== undefined ? { fromCursor: command.fromCursor } : {}),
        deadlineAt: command.deadlineAt,
        mappingSnapshotHash: command.mappingSnapshotHash,
      })
      if (!collected.ok) {
        return this.block(current.reconciliationRunId, startCommit.value.postCommitEvidence)
      }
      external = collected.value.snapshot
      if (
        external.snapshotId !== command.externalSnapshotId
        || external.portfolioId !== command.portfolioId
        || external.accountBindingId !== command.accountBindingId
        || external.source === 'LOCAL'
        || !collected.value.coherent
        || this.deadlineExceeded(current, command, startedMs)
      ) {
        return this.block(current.reconciliationRunId, startCommit.value.postCommitEvidence)
      }
      const coherence = verifySnapshotCoherence(external.endpointTimes, external.cursor)
      if (!coherence.ok) {
        return this.block(current.reconciliationRunId, startCommit.value.postCommitEvidence)
      }
    }
    if (external === undefined) {
      return this.block(current.reconciliationRunId, startCommit.value.postCommitEvidence)
    }
    if (
      external.snapshotId !== command.externalSnapshotId
      || external.portfolioId !== command.portfolioId
      || external.accountBindingId !== command.accountBindingId
      || external.source === 'LOCAL'
      || this.deadlineExceeded(current, command, startedMs)
    ) {
      return this.block(current.reconciliationRunId, startCommit.value.postCommitEvidence)
    }
    const resumedCoherence = verifySnapshotCoherence(external.endpointTimes, external.cursor)
    if (!resumedCoherence.ok) {
      return this.block(current.reconciliationRunId, startCommit.value.postCommitEvidence)
    }

    const comparingCommit = this.persistComparing(current, external)
    if (!comparingCommit.ok) return comparingCommit
    current = comparingCommit.value.value
    const evidenceBeforeFinal = Object.freeze([
      ...startCommit.value.postCommitEvidence,
      ...comparingCommit.value.postCommitEvidence,
    ])
    if (isTerminalReconciliationState(current.state)) {
      return success(Object.freeze({
        value: current,
        postCommitEvidence: evidenceBeforeFinal,
      }))
    }
    if (this.deadlineExceeded(current, command, startedMs)) {
      return this.block(current.reconciliationRunId, evidenceBeforeFinal)
    }
    const differencesResult = this.comparator.compare(
      startCommit.value.value.localSnapshot,
      external,
    )
    if (!differencesResult.ok) {
      return this.block(current.reconciliationRunId, evidenceBeforeFinal)
    }
    const differences = differencesResult.value
    const missingFillOrderIds = new Set(
      differences
        .filter((difference) => difference.kind === 'LOCAL_MISSING_FILL')
        .map((difference) => difference.orderId)
        .filter((orderId) => orderId !== undefined),
    )
    const unknownOrderIds = new Set(
      differences
        .filter((difference) => difference.kind === 'UNKNOWN_ORDER')
        .map((difference) => difference.orderId)
        .filter((orderId) => orderId !== undefined),
    )
    for (const fill of external.fills) {
      if (!missingFillOrderIds.has(fill.orderId)) continue
      if (this.deadlineExceeded(current, command, startedMs)) {
        return this.block(current.reconciliationRunId, evidenceBeforeFinal)
      }
      const applied = await this.missingFillApplier.apply(fill)
      if (!applied.ok) {
        return this.block(current.reconciliationRunId, evidenceBeforeFinal)
      }
    }
    const resolvedUnknowns = this.resolveUnknownOrders(external, unknownOrderIds)
    if (!resolvedUnknowns.ok) {
      return this.block(current.reconciliationRunId, evidenceBeforeFinal)
    }
    return this.complete(
      current,
      external,
      differences,
      Object.freeze([
        ...evidenceBeforeFinal,
        ...resolvedUnknowns.value.postCommitEvidence,
      ]),
    )
  }

  private resolveUnknownOrders(
    external: ReconciliationSnapshotRecord,
    eligibleOrderIds: ReadonlySet<OrderId>,
  ): DomainResult<CommittedExecutionResult<readonly OrderId[]>, AnyDomainFailure> {
    return this.unitOfWork.execute((transaction) => {
      const evidence: ExecutionEvidencePayload[] = []
      const resolvedOrderIds: OrderId[] = []
      for (const brokerOrder of external.openOrders) {
        const orderResult = transaction.orders.findByBrokerReference(
          external.portfolioId,
          brokerOrder.brokerReference.brokerOrderReferenceId,
        )
        if (!orderResult.ok) return orderResult
        const current = orderResult.value
        if (
          current === undefined
          || current.state !== 'UNKNOWN'
          || !eligibleOrderIds.has(current.orderId)
        ) continue
        const resolvedState = this.provenResolvedState(current, brokerOrder)
        if (resolvedState === undefined) continue
        const resolved = resolveFromUnknown(
          current,
          resolvedState,
          current.stateVersion + 1,
        )
        if (!resolved.ok) return resolved
        let persistedOrder = resolved.value
        const releaseEvidence: (
          PortfolioAccountingEvidencePayload
          | ExecutionRunPortfolioVersionEvidencePayload
        )[] = []
        if (
          resolvedState === 'REJECTED'
          || resolvedState === 'EXPIRED'
          || resolvedState === 'CANCELLED'
        ) {
          const runResult = transaction.runs.getById(current.executionRunId)
          if (!runResult.ok) return runResult
          if (runResult.value === undefined) {
            return failure(domainFailure('DUPLICATE_EXECUTION_RUN', {
              field: 'executionRunId',
              retryability: 'NEVER',
            }))
          }
          const portfolioCurrent = transaction.portfolioState.assertCurrent(
            runResult.value.portfolioId,
            runResult.value.portfolioStateVersion,
            'ACTIVE',
          )
          if (!portfolioCurrent.ok) return portfolioCurrent
          const released = this.terminalRelease.release(transaction, resolved.value)
          if (!released.ok) return released
          const validRelease = validateTerminalReservationRelease(
            current,
            resolved.value,
            runResult.value,
            released.value,
          )
          if (!validRelease.ok) return validRelease
          persistedOrder = validRelease.value.order
          if (validRelease.value.accountingEvidence !== undefined) {
            releaseEvidence.push(validRelease.value.accountingEvidence)
          }
          if (validRelease.value.runEvidence !== undefined) {
            releaseEvidence.push(validRelease.value.runEvidence)
          }
        }
        const saved = transaction.orders.save(persistedOrder, current.stateVersion)
        if (!saved.ok) return saved
        resolvedOrderIds.push(current.orderId)
        evidence.push(
          ...releaseEvidence,
          Object.freeze({
            kind: 'ORDER_STATE_CHANGED',
            portfolioId: current.portfolioId,
            executionRunId: current.executionRunId,
            orderId: current.orderId,
            previousState: current.state,
            newState: persistedOrder.state,
            stateVersion: persistedOrder.stateVersion,
            occurredAt: this.clock.now(),
          }),
        )
      }
      if (evidence.length > 0) {
        const staged = transaction.stageEvidence(evidence)
        if (!staged.ok) return staged
      }
      return success(Object.freeze(resolvedOrderIds))
    })
  }

  private provenResolvedState(
    order: ExecutionOrderSnapshot,
    brokerOrder: ReconciliationSnapshotRecord['openOrders'][number],
  ): BrokerOrderStatus | undefined {
    if (
      brokerOrder.brokerReference.brokerOrderReferenceId
        !== order.brokerReference?.brokerOrderReferenceId
      || brokerOrder.filledQuantity.shares !== order.filledQuantity.shares
    ) return undefined
    switch (brokerOrder.status) {
      case 'FILLED':
        return order.intent !== undefined
          && order.filledQuantity.shares === order.intent.quantity.shares
          && brokerOrder.filledQuantity.shares === order.intent.quantity.shares
          && brokerOrder.openQuantity.shares === 0n
          ? 'FILLED'
          : undefined
      case 'PARTIALLY_FILLED':
        return order.filledQuantity.shares > 0n
          && brokerOrder.openQuantity.shares > 0n
          ? 'PARTIALLY_FILLED'
          : undefined
      case 'ACKNOWLEDGED':
      case 'OPEN':
        return order.filledQuantity.shares === 0n
          ? brokerOrder.status
          : undefined
      case 'CANCELLED':
      case 'REJECTED':
      case 'EXPIRED':
        return brokerOrder.openQuantity.shares === 0n
          ? brokerOrder.status
          : undefined
      case 'CANCEL_PENDING':
      case 'UNKNOWN':
        return undefined
    }
  }

  private startOrResume(
    command: ReconcileCommand,
  ): DomainResult<CommittedExecutionResult<StartedReconciliation>, AnyDomainFailure> {
    return this.unitOfWork.execute((transaction) => {
      const existingResult = transaction.reconciliationRuns.getById(
        command.run.reconciliationRunId,
      )
      if (!existingResult.ok) return existingResult
      const storedLocalResult = transaction.reconciliationSnapshots.getById(
        command.localSnapshot.snapshotId,
      )
      if (!storedLocalResult.ok) return storedLocalResult
      const evidence: ExecutionEvidencePayload[] = []
      if (
        storedLocalResult.value !== undefined
        && (
          storedLocalResult.value.portfolioId !== command.portfolioId
          || storedLocalResult.value.source !== 'LOCAL'
          || storedLocalResult.value.contentHash !== command.localSnapshot.contentHash
        )
      ) {
        return failure(domainFailure('RECONCILIATION_STATE_INVALID', {
          field: 'localSnapshot',
          retryability: 'NEVER',
        }))
      }
      if (storedLocalResult.value === undefined) {
        const inserted = transaction.reconciliationSnapshots.insert(command.localSnapshot)
        if (!inserted.ok) return inserted
        evidence.push(Object.freeze({
          kind: 'RECONCILIATION_SNAPSHOT_RECORDED',
          portfolioId: command.portfolioId,
          reconciliationRunId: command.run.reconciliationRunId,
          snapshotId: command.localSnapshot.snapshotId,
          source: command.localSnapshot.source,
          contentHashPrefix: command.localSnapshot.contentHash.slice(0, 12),
          occurredAt: command.localSnapshot.capturedAt,
        }))
      }
      let run = existingResult.value
      if (run === undefined) {
        const latestResult = transaction.reconciliationRuns.findLatestByPortfolio(
          command.portfolioId,
        )
        if (!latestResult.ok) return latestResult
        const latest = latestResult.value
        const latestRequiresFreshProof = latest !== undefined
          && latest.reconciliationRunId !== command.run.reconciliationRunId
          && latest.differences.some((difference) =>
            difference.kind === 'LOCAL_MISSING_FILL'
            || difference.kind === 'UNKNOWN_ORDER')
        if (
          latestRequiresFreshProof
          && command.run.priorRunId !== latest?.reconciliationRunId
        ) {
          return failure(domainFailure('RECONCILIATION_STATE_INVALID', {
            field: 'priorRunId',
            retryability: 'NEVER',
          }))
        }
        if (command.run.priorRunId !== undefined) {
          const priorResult = transaction.reconciliationRuns.getById(
            command.run.priorRunId,
          )
          if (!priorResult.ok) return priorResult
          if (
            priorResult.value === undefined
            || priorResult.value.portfolioId !== command.portfolioId
            || !isTerminalReconciliationState(priorResult.value.state)
            || priorResult.value.completedAt === undefined
            || command.localSnapshot.capturedAt <= priorResult.value.completedAt
            || command.run.startedAt < priorResult.value.completedAt
            || command.localSnapshot.snapshotId === priorResult.value.localSnapshotId
            || command.localSnapshot.snapshotId === priorResult.value.externalSnapshotId
          ) {
            return failure(domainFailure('RECONCILIATION_STATE_INVALID', {
              field: 'priorRunId',
              retryability: 'NEVER',
            }))
          }
        }
        if (command.run.state !== 'REQUESTED') {
          return failure(domainFailure('RECONCILIATION_STATE_INVALID', {
            field: 'state',
            retryability: 'NEVER',
          }))
        }
        const collecting = transitionReconciliationState(
          command.run,
          'COLLECTING',
          command.run.stateVersion + 1,
        )
        if (!collecting.ok) return collecting
        const inserted = transaction.reconciliationRuns.insert(collecting.value)
        if (!inserted.ok) return inserted
        evidence.push(this.stateEvidence(command.run, collecting.value))
        run = collecting.value
      } else {
        if (
          run.portfolioId !== command.portfolioId
          || run.localSnapshotId !== command.localSnapshot.snapshotId
        ) {
          return failure(domainFailure('RECONCILIATION_STATE_INVALID', {
            field: 'run',
            retryability: 'NEVER',
          }))
        }
        if (run.state === 'REQUESTED') {
          const collecting = transitionReconciliationState(
            run,
            'COLLECTING',
            run.stateVersion + 1,
          )
          if (!collecting.ok) return collecting
          const saved = transaction.reconciliationRuns.save(
            collecting.value,
            run.stateVersion,
          )
          if (!saved.ok) return saved
          evidence.push(this.stateEvidence(run, collecting.value))
          run = collecting.value
        }
      }
      let externalSnapshot: ReconciliationSnapshotRecord | undefined
      const externalId = run.externalSnapshotId ?? command.externalSnapshotId
      const externalResult = transaction.reconciliationSnapshots.getById(externalId)
      if (!externalResult.ok) return externalResult
      externalSnapshot = externalResult.value
      if (evidence.length > 0) {
        const staged = transaction.stageEvidence(evidence)
        if (!staged.ok) return staged
      }
      return success(Object.freeze({
        run,
        localSnapshot: storedLocalResult.value ?? command.localSnapshot,
        ...(externalSnapshot !== undefined ? { externalSnapshot } : {}),
      }))
    })
  }

  private persistComparing(
    expected: ReconciliationRunSnapshot,
    external: ReconciliationSnapshotRecord,
  ): DomainResult<CommittedExecutionResult<ReconciliationRunSnapshot>, AnyDomainFailure> {
    return this.unitOfWork.execute((transaction) => {
      const runResult = transaction.reconciliationRuns.getById(expected.reconciliationRunId)
      if (!runResult.ok) return runResult
      const run = runResult.value
      if (run === undefined) {
        return failure(domainFailure('RECONCILIATION_STATE_INVALID', {
          field: 'run',
          retryability: 'NEVER',
        }))
      }
      if (run.state === 'COMPARING') {
        if (run.externalSnapshotId !== external.snapshotId) {
          return failure(domainFailure('RECONCILIATION_STATE_INVALID', {
            field: 'externalSnapshotId',
            retryability: 'NEVER',
          }))
        }
        return success(run)
      }
      if (isTerminalReconciliationState(run.state)) return success(run)
      if (run.state !== 'COLLECTING') {
        return failure(domainFailure('RECONCILIATION_STATE_INVALID', {
          field: 'state',
          retryability: 'NEVER',
        }))
      }
      const existingSnapshot = transaction.reconciliationSnapshots.getById(
        external.snapshotId,
      )
      if (!existingSnapshot.ok) return existingSnapshot
      const evidence: ExecutionEvidencePayload[] = []
      if (
        existingSnapshot.value !== undefined
        && (
          existingSnapshot.value.portfolioId !== external.portfolioId
          || existingSnapshot.value.source !== external.source
          || existingSnapshot.value.contentHash !== external.contentHash
        )
      ) {
        return failure(domainFailure('RECONCILIATION_STATE_INVALID', {
          field: 'externalSnapshot',
          retryability: 'NEVER',
        }))
      }
      if (existingSnapshot.value === undefined) {
        const inserted = transaction.reconciliationSnapshots.insert(external)
        if (!inserted.ok) return inserted
        evidence.push(Object.freeze({
          kind: 'RECONCILIATION_SNAPSHOT_RECORDED',
          portfolioId: run.portfolioId,
          reconciliationRunId: run.reconciliationRunId,
          snapshotId: external.snapshotId,
          source: external.source,
          contentHashPrefix: external.contentHash.slice(0, 12),
          occurredAt: external.capturedAt,
        }))
      }
      const comparing = transitionReconciliationState(
        run,
        'COMPARING',
        run.stateVersion + 1,
        undefined,
        undefined,
        external.snapshotId,
      )
      if (!comparing.ok) return comparing
      const saved = transaction.reconciliationRuns.save(comparing.value, run.stateVersion)
      if (!saved.ok) return saved
      evidence.push(this.stateEvidence(run, comparing.value))
      const staged = transaction.stageEvidence(evidence)
      if (!staged.ok) return staged
      return success(comparing.value)
    })
  }

  private complete(
    expected: ReconciliationRunSnapshot,
    external: ReconciliationSnapshotRecord,
    differences: readonly ReconciliationDifference[],
    priorEvidence: readonly ExecutionEvidencePayload[],
  ): DomainResult<CommittedExecutionResult<ReconciliationRunSnapshot>, AnyDomainFailure> {
    const commit = this.unitOfWork.execute((transaction) => {
      const runResult = transaction.reconciliationRuns.getById(expected.reconciliationRunId)
      if (!runResult.ok) return runResult
      const run = runResult.value
      if (run === undefined) {
        return failure(domainFailure('RECONCILIATION_STATE_INVALID', {
          field: 'run',
          retryability: 'NEVER',
        }))
      }
      if (isTerminalReconciliationState(run.state)) return success(run)
      if (run.state !== 'COMPARING' || run.externalSnapshotId !== external.snapshotId) {
        return failure(domainFailure('RECONCILIATION_STATE_INVALID', {
          field: 'state',
          retryability: 'NEVER',
        }))
      }
      const completed = transitionReconciliationState(
        run,
        deriveReconciliationResult(differences),
        run.stateVersion + 1,
        this.clock.now(),
        differences,
        external.snapshotId,
      )
      if (!completed.ok) return completed
      const saved = transaction.reconciliationRuns.save(completed.value, run.stateVersion)
      if (!saved.ok) return saved
      const staged = transaction.stageEvidence([Object.freeze({
        kind: 'RECONCILIATION_COMPLETED',
        portfolioId: run.portfolioId,
        reconciliationRunId: run.reconciliationRunId,
        state: completed.value.state,
        differenceCount: differences.length,
        occurredAt: completed.value.completedAt ?? this.clock.now(),
      })])
      if (!staged.ok) return staged
      return success(completed.value)
    })
    if (!commit.ok) return commit
    return success(Object.freeze({
      value: commit.value.value,
      postCommitEvidence: Object.freeze([
        ...priorEvidence,
        ...commit.value.postCommitEvidence,
      ]),
    }))
  }

  private block(
    reconciliationRunId: ReconciliationRunId,
    priorEvidence: readonly ExecutionEvidencePayload[],
  ): DomainResult<CommittedExecutionResult<ReconciliationRunSnapshot>, AnyDomainFailure> {
    const commit = this.unitOfWork.execute((transaction) => {
      const runResult = transaction.reconciliationRuns.getById(reconciliationRunId)
      if (!runResult.ok) return runResult
      const run = runResult.value
      if (run === undefined) {
        return failure(domainFailure('RECONCILIATION_STATE_INVALID', {
          field: 'run',
          retryability: 'NEVER',
        }))
      }
      if (isTerminalReconciliationState(run.state)) return success(run)
      const blocked = transitionReconciliationState(
        run,
        'BLOCKED',
        run.stateVersion + 1,
        this.clock.now(),
      )
      if (!blocked.ok) return blocked
      const saved = transaction.reconciliationRuns.save(blocked.value, run.stateVersion)
      if (!saved.ok) return saved
      const staged = transaction.stageEvidence([Object.freeze({
        kind: 'RECONCILIATION_COMPLETED',
        portfolioId: run.portfolioId,
        reconciliationRunId,
        state: blocked.value.state,
        differenceCount: blocked.value.differences.length,
        occurredAt: blocked.value.completedAt ?? this.clock.now(),
      })])
      if (!staged.ok) return staged
      return success(blocked.value)
    })
    if (!commit.ok) return commit
    return success(Object.freeze({
      value: commit.value.value,
      postCommitEvidence: Object.freeze([
        ...priorEvidence,
        ...commit.value.postCommitEvidence,
      ]),
    }))
  }

  private stateEvidence(
    previous: ReconciliationRunSnapshot,
    next: ReconciliationRunSnapshot,
  ): ExecutionEvidencePayload {
    return Object.freeze({
      kind: 'RECONCILIATION_STATE_CHANGED',
      portfolioId: next.portfolioId,
      reconciliationRunId: next.reconciliationRunId,
      previousState: previous.state,
      newState: next.state,
      stateVersion: next.stateVersion,
      occurredAt: this.clock.now(),
    })
  }

  private deadlineExceeded(
    run: ReconciliationRunSnapshot,
    command: ReconcileCommand,
    startedMs: number,
  ): boolean {
    return (
      this.monotonic.nowMs() - startedMs > command.totalDeadlineMs
      || this.clock.now() > command.deadlineAt
      || Date.parse(this.clock.now()) - Date.parse(run.startedAt) > command.totalDeadlineMs
    )
  }
}
