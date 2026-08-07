import type { AnyDomainFailure } from "../../domain/errors/result.ts"
import { domainFailure } from "../../domain/errors/failure.ts"
import { failure, success, type DomainResult } from "../../domain/errors/result.ts"
import type { ActorId, CorrelationId, StrategyVersionEventId, StrategyVersionId } from "../../domain/shared/identifiers.ts"
import type { EvidenceReference, StrategyVersion } from "../../domain/strategy/strategy-version.ts"
import {
  activate,
  createVersion,
  submitForActivation,
  withdrawVersion,
} from "../../domain/strategy/strategy-version.ts"
import { createStrategyConfig } from "../../domain/strategy/strategy-config.ts"
import type { StrategyVersionRepository } from "../../ports/strategy/strategy-version-repository.ts"
import type { StrategyVersionUnitOfWork } from "../../ports/strategy/strategy-unit-of-work.ts"
import type { ClockPort, IdentifierFactory } from "../../ports/index.ts"

export class StrategyVersionService {
  private readonly strategyVersionRepo: StrategyVersionRepository
  private readonly activationUoW: StrategyVersionUnitOfWork
  private readonly clock: ClockPort
  private readonly identifiers: IdentifierFactory

  constructor(
    strategyVersionRepo: StrategyVersionRepository,
    activationUoW: StrategyVersionUnitOfWork,
    clock: ClockPort,
    identifiers: IdentifierFactory,
  ) {
    this.strategyVersionRepo = strategyVersionRepo
    this.activationUoW = activationUoW
    this.clock = clock
    this.identifiers = identifiers
  }

  createStrategyVersion(params: {
    strategyId: string
    versionLabel: string
    rawConfig: unknown
    createdBy: ActorId
    correlationId: CorrelationId
    isPreset?: boolean
  }): DomainResult<StrategyVersion, AnyDomainFailure> {
    const configResult = createStrategyConfig(params.rawConfig)
    if (!configResult.ok) return configResult

    const strategyVersionId = this.identifiers.strategyVersionId()
    const eventId = this.identifiers.eventId() as unknown as StrategyVersionEventId

    const createResult = createVersion({
      strategyVersionId,
      strategyId: params.strategyId,
      versionLabel: params.versionLabel,
      config: configResult.value.config,
      configHash: configResult.value.hash,
      createdBy: params.createdBy,
      createdAt: this.clock.now(),
      isPreset: params.isPreset ?? false,
      eventId,
      correlationId: params.correlationId,
    })
    if (!createResult.ok) return createResult

    const insertResult = this.strategyVersionRepo.insert(createResult.value.version)
    if (!insertResult.ok) return insertResult

    return success(createResult.value.version)
  }

  submitForActivation(params: {
    strategyVersionId: StrategyVersionId
    evidenceRefs: readonly EvidenceReference[]
    submittedBy: ActorId
    correlationId: CorrelationId
  }): DomainResult<StrategyVersion, AnyDomainFailure> {
    const loadResult = this.strategyVersionRepo.getById(params.strategyVersionId)
    if (!loadResult.ok) return loadResult
    const version = loadResult.value
    if (!version) return failure(domainFailure("STRATEGY_VERSION_NOT_FOUND", { field: "strategyVersionId" }))

    const eventId = this.identifiers.eventId() as unknown as StrategyVersionEventId
    const result = submitForActivation(version, {
      evidenceRefs: params.evidenceRefs,
      submittedBy: params.submittedBy,
      submittedAt: this.clock.now(),
      eventId,
      correlationId: params.correlationId,
    })
    if (!result.ok) return result

    const saveResult = this.strategyVersionRepo.save(result.value.version)
    if (!saveResult.ok) return saveResult

    return success(result.value.version)
  }

  activateVersion(params: {
    strategyVersionId: StrategyVersionId
    approvedBy: ActorId
    correlationId: CorrelationId
  }): DomainResult<StrategyVersion, AnyDomainFailure> {
    const loadResult = this.strategyVersionRepo.getById(params.strategyVersionId)
    if (!loadResult.ok) return loadResult
    const version = loadResult.value
    if (!version) return failure(domainFailure("STRATEGY_VERSION_NOT_FOUND", { field: "strategyVersionId" }))

    const previousActiveResult = this.strategyVersionRepo.getActiveByStrategyId(version.strategyId)
    if (!previousActiveResult.ok) return previousActiveResult

    const now = this.clock.now()
    const eventId = this.identifiers.eventId() as unknown as StrategyVersionEventId
    const supersededEventId = this.identifiers.eventId() as unknown as StrategyVersionEventId

    const activateResult = activate(version, previousActiveResult.value, {
      approvedBy: params.approvedBy,
      approvedAt: now,
      effectiveFrom: now,
      eventId,
      supersededEventId,
      correlationId: params.correlationId,
    })
    if (!activateResult.ok) return activateResult

    const uowResult = this.activationUoW.executeActivation(
      activateResult.value.activated,
      activateResult.value.superseded,
      activateResult.value.events,
    )
    if (!uowResult.ok) return uowResult

    return success(uowResult.value.value)
  }

  withdrawVersion(params: {
    strategyVersionId: StrategyVersionId
    withdrawnBy: ActorId
    withdrawalReason: string
    correlationId: CorrelationId
  }): DomainResult<StrategyVersion, AnyDomainFailure> {
    const loadResult = this.strategyVersionRepo.getById(params.strategyVersionId)
    if (!loadResult.ok) return loadResult
    const version = loadResult.value
    if (!version) return failure(domainFailure("STRATEGY_VERSION_NOT_FOUND", { field: "strategyVersionId" }))

    const eventId = this.identifiers.eventId() as unknown as StrategyVersionEventId
    const result = withdrawVersion(version, {
      withdrawnBy: params.withdrawnBy,
      withdrawnAt: this.clock.now(),
      withdrawalReason: params.withdrawalReason,
      eventId,
      correlationId: params.correlationId,
    })
    if (!result.ok) return result

    const saveResult = this.strategyVersionRepo.save(result.value.version)
    if (!saveResult.ok) return saveResult

    return success(result.value.version)
  }
}
