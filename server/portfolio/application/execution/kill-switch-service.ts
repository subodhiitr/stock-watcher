import {
  activateKillSwitch,
  resetAllowsAutoResume,
  resetKillSwitch,
  type KillSwitchActivation,
  type KillSwitchReset,
  type KillSwitchScope,
  type KillSwitchSnapshot,
} from '../../domain/execution/kill-switch.ts'
import type { ExecutionEvidencePayload } from '../../domain/execution/evidence.ts'
import type { ExecutionOrderSnapshot } from '../../domain/execution/execution-order.ts'
import { domainFailure } from '../../domain/errors/failure.ts'
import {
  failure,
  success,
  type AnyDomainFailure,
  type DomainResult,
} from '../../domain/errors/result.ts'
import type {
  CommittedExecutionResult,
  ExecutionUnitOfWork,
  KillSwitchResetEligibilityToken,
} from '../../ports/execution/execution-unit-of-work.ts'
import type { ExecutionClockPort } from '../../ports/execution/runtime-port.ts'
import {
  CancellationCoordinator,
  type CancelOrderCommand,
} from './cancellation-coordinator.ts'
import type {
  ExecutionDispatchFence,
  UnresolvedDispatchAdmission,
} from './placement-coordinator.ts'

export type ActivateKillSwitchCommand = Readonly<{
  snapshot: KillSwitchSnapshot
  activation: KillSwitchActivation
}>

export type ResetKillSwitchCommand = Readonly<{
  snapshot: KillSwitchSnapshot
  reset: Omit<KillSwitchReset, 'healthSnapshotHash' | 'reconciliationSnapshotIds'>
}>

export interface KillSwitchResetEligibilityPort {
  assess(
    scope: KillSwitchScope,
    asOf: KillSwitchReset['resetAt'],
  ): Promise<DomainResult<KillSwitchResetEligibilityToken>>
}

export interface CancellationCommandFactory {
  create(
    order: ExecutionOrderSnapshot,
    killSwitch: KillSwitchSnapshot,
  ): DomainResult<CancelOrderCommand>
}

export interface UnresolvedDispatchContainment {
  containAndRequireReconciliation(
    unresolved: UnresolvedDispatchAdmission,
    killSwitch: KillSwitchSnapshot,
  ): Promise<DomainResult<void, AnyDomainFailure>>
}

export type KillSwitchActivationResult = Readonly<{
  snapshot: KillSwitchSnapshot
  cancellationCoverageComplete: boolean
  unresolvedAdmissions: readonly UnresolvedDispatchAdmission[]
}>

type ActivatedKillSwitch = Readonly<{
  snapshot: KillSwitchSnapshot
  cancellableOrders: readonly ExecutionOrderSnapshot[]
}>

export class KillSwitchService {
  private readonly unitOfWork: ExecutionUnitOfWork
  private readonly cancellations: CancellationCoordinator
  private readonly clock: ExecutionClockPort
  private readonly resetEligibility: KillSwitchResetEligibilityPort
  private readonly cancellationCommands: CancellationCommandFactory
  private readonly dispatchFence: ExecutionDispatchFence
  private readonly unresolvedContainment: UnresolvedDispatchContainment

  constructor(
    unitOfWork: ExecutionUnitOfWork,
    cancellations: CancellationCoordinator,
    clock: ExecutionClockPort,
    resetEligibility: KillSwitchResetEligibilityPort,
    cancellationCommands: CancellationCommandFactory,
    dispatchFence: ExecutionDispatchFence,
    unresolvedContainment: UnresolvedDispatchContainment,
  ) {
    this.unitOfWork = unitOfWork
    this.cancellations = cancellations
    this.clock = clock
    this.resetEligibility = resetEligibility
    this.cancellationCommands = cancellationCommands
    this.dispatchFence = dispatchFence
    this.unresolvedContainment = unresolvedContainment
  }

  async activate(
    command: ActivateKillSwitchCommand,
  ): Promise<DomainResult<CommittedExecutionResult<KillSwitchActivationResult>, AnyDomainFailure>> {
    const closed = await this.dispatchFence.closeAndDrain(command.snapshot.scope)
    if (!closed.ok) return closed
    const commit = this.unitOfWork.execute<ActivatedKillSwitch>((transaction) => {
      const existing = transaction.killSwitches.getById(command.snapshot.killSwitchId)
      if (!existing.ok) return existing
      const current = existing.value ?? command.snapshot
      if (
        current.scope.kind !== command.snapshot.scope.kind
        || (
          current.scope.kind === 'PORTFOLIO'
          && command.snapshot.scope.kind === 'PORTFOLIO'
          && current.scope.portfolioId !== command.snapshot.scope.portfolioId
        )
      ) {
        return failure(domainFailure('KILL_SWITCH_ACTIVATION_INVALID', {
          field: 'scope',
          retryability: 'NEVER',
        }))
      }
      let activatedSnapshot = current
      if (current.state !== 'ACTIVE') {
        const activated = activateKillSwitch(
          current,
          command.activation,
          current.stateVersion + 1,
        )
        if (!activated.ok) return activated
        const persisted = existing.value === undefined
          ? transaction.killSwitches.insert(activated.value)
          : transaction.killSwitches.save(activated.value, current.stateVersion)
        if (!persisted.ok) return persisted
        const evidence: ExecutionEvidencePayload =
          activated.value.scope.kind === 'PORTFOLIO'
          ? Object.freeze({
            kind: 'KILL_SWITCH_ACTIVATED',
            portfolioId: activated.value.scope.portfolioId,
            killSwitchId: activated.value.killSwitchId,
            scopeKind: 'PORTFOLIO',
            state: activated.value.state,
            reasonCode: command.activation.reasonCode,
            stateVersion: activated.value.stateVersion,
            occurredAt: command.activation.activatedAt,
          })
          : Object.freeze({
            kind: 'KILL_SWITCH_ACTIVATED',
            globalStreamId: 'GLOBAL_EXECUTION_CONTROL',
            killSwitchId: activated.value.killSwitchId,
            scopeKind: 'GLOBAL',
            state: activated.value.state,
            reasonCode: command.activation.reasonCode,
            stateVersion: activated.value.stateVersion,
            occurredAt: command.activation.activatedAt,
          })
        const staged = transaction.stageEvidence([evidence])
        if (!staged.ok) return staged
        activatedSnapshot = activated.value
      }
      const cancellable = transaction.orders.listCancellableByScope(
        activatedSnapshot.scope,
      )
      if (!cancellable.ok) return cancellable
      return success<ActivatedKillSwitch>(Object.freeze({
        snapshot: activatedSnapshot,
        cancellableOrders: cancellable.value,
      }))
    })
    if (!commit.ok) return commit

    const evidence = [...commit.value.postCommitEvidence]
    let activationFailure: AnyDomainFailure | undefined
    for (const unresolved of closed.value.unresolvedAdmissions) {
      const contained = await this.unresolvedContainment
        .containAndRequireReconciliation(
          unresolved,
          commit.value.value.snapshot,
        )
      if (!contained.ok && activationFailure === undefined) {
        activationFailure = contained.error
      }
    }
    for (const order of commit.value.value.cancellableOrders) {
      const cancellationResult = this.cancellationCommands.create(
        order,
        commit.value.value.snapshot,
      )
      if (!cancellationResult.ok) {
        activationFailure ??= cancellationResult.error
        continue
      }
      const cancellation = cancellationResult.value
      const cancelled = await this.cancellations.request(cancellation)
      if (!cancelled.ok) {
        activationFailure ??= cancelled.error
        continue
      }
      evidence.push(...cancelled.value.postCommitEvidence)
    }
    if (activationFailure !== undefined) return failure(activationFailure)
    return success(Object.freeze({
      value: Object.freeze({
        snapshot: commit.value.value.snapshot,
        cancellationCoverageComplete:
          closed.value.unresolvedAdmissions.length === 0,
        unresolvedAdmissions: Object.freeze([
          ...closed.value.unresolvedAdmissions,
        ]),
      }),
      postCommitEvidence: Object.freeze(evidence),
    }))
  }

  async reset(
    command: ResetKillSwitchCommand,
  ): Promise<DomainResult<CommittedExecutionResult<KillSwitchSnapshot>, AnyDomainFailure>> {
    if (
      !command.reset.authorizationEvidenceId
      || !command.reset.mfaEvidenceId
    ) {
      return failure(domainFailure('KILL_SWITCH_RESET_BLOCKED', {
        field: 'authorizationEvidence',
        retryability: 'NEVER',
      }))
    }
    const resetClosure = await this.dispatchFence.closeAndDrain(
      command.snapshot.scope,
    )
    if (!resetClosure.ok) return resetClosure
    if (resetClosure.value.unresolvedAdmissions.length > 0) {
      return failure(domainFailure('KILL_SWITCH_RESET_BLOCKED', {
        field: 'unresolvedAdmissions',
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
    const eligibilityResult = await this.resetEligibility.assess(
      command.snapshot.scope,
      command.reset.resetAt,
    )
    if (!eligibilityResult.ok) return eligibilityResult
    const eligibility = eligibilityResult.value
    if (resetAllowsAutoResume()) {
      return failure(domainFailure('KILL_SWITCH_AUTO_RESUME_FORBIDDEN', {
        field: 'autoResume',
        retryability: 'NEVER',
      }))
    }
    const commit = this.unitOfWork.execute((transaction) => {
      const currentResult = transaction.killSwitches.getById(
        command.snapshot.killSwitchId,
      )
      if (!currentResult.ok) return currentResult
      const current = currentResult.value
      if (
        current === undefined
        || current.scope.kind !== command.snapshot.scope.kind
        || (
          current.scope.kind === 'PORTFOLIO'
          && command.snapshot.scope.kind === 'PORTFOLIO'
          && current.scope.portfolioId !== command.snapshot.scope.portfolioId
        )
      ) {
        return failure(domainFailure('KILL_SWITCH_RESET_BLOCKED', {
          field: 'scope',
          retryability: 'AFTER_STATE_REFRESH',
        }))
      }
      const currentEligibility = transaction.killSwitchResetEligibility
        .assertCurrent(eligibility)
      if (!currentEligibility.ok) return currentEligibility
      const resetRecord: KillSwitchReset = Object.freeze({
        ...command.reset,
        healthSnapshotHash: eligibility.healthSnapshotHash,
        reconciliationSnapshotIds: Object.freeze([
          ...eligibility.reconciliationSnapshotIds,
        ]),
      })
      const reset = resetKillSwitch(
        current,
        resetRecord,
        current.stateVersion + 1,
      )
      if (!reset.ok) return reset
      const saved = transaction.killSwitches.save(
        reset.value,
        current.stateVersion,
      )
      if (!saved.ok) return saved
      const evidence: ExecutionEvidencePayload =
        reset.value.scope.kind === 'PORTFOLIO'
          ? Object.freeze({
            kind: 'KILL_SWITCH_RESET',
            portfolioId: reset.value.scope.portfolioId,
            killSwitchId: reset.value.killSwitchId,
            scopeKind: 'PORTFOLIO',
            state: reset.value.state,
            reasonCode: resetRecord.reasonCode,
            authorizationEvidenceId: resetRecord.authorizationEvidenceId,
            mfaEvidenceId: resetRecord.mfaEvidenceId,
            healthSnapshotHash: resetRecord.healthSnapshotHash,
            reconciliationSnapshotIds: resetRecord.reconciliationSnapshotIds,
            stateVersion: reset.value.stateVersion,
            occurredAt: resetRecord.resetAt,
          })
          : Object.freeze({
            kind: 'KILL_SWITCH_RESET',
            globalStreamId: 'GLOBAL_EXECUTION_CONTROL',
            killSwitchId: reset.value.killSwitchId,
            scopeKind: 'GLOBAL',
            state: reset.value.state,
            reasonCode: resetRecord.reasonCode,
            authorizationEvidenceId: resetRecord.authorizationEvidenceId,
            mfaEvidenceId: resetRecord.mfaEvidenceId,
            healthSnapshotHash: resetRecord.healthSnapshotHash,
            reconciliationSnapshotIds: resetRecord.reconciliationSnapshotIds,
            stateVersion: reset.value.stateVersion,
            occurredAt: resetRecord.resetAt,
          })
      const staged = transaction.stageEvidence([evidence])
      if (!staged.ok) return staged
      return success(reset.value)
    })
    if (!commit.ok) return commit
    const committedReset = commit.value.value
    const opened = await this.dispatchFence.open(
      committedReset.scope,
      resetClosure.value.closure,
      () => {
        const current = this.unitOfWork.execute((transaction) => {
          const currentResult = transaction.killSwitches.getById(
            committedReset.killSwitchId,
          )
          if (!currentResult.ok) return currentResult
          if (
            currentResult.value === undefined
            || currentResult.value.state !== 'INACTIVE'
            || currentResult.value.stateVersion !== committedReset.stateVersion
          ) {
            return failure(domainFailure('KILL_SWITCH_RESET_BLOCKED', {
              field: 'stateVersion',
              retryability: 'AFTER_STATE_REFRESH',
            }))
          }
          return success(undefined)
        })
        return current.ok ? success(undefined) : current
      },
    )
    if (!opened.ok) return opened
    return commit
  }
}
