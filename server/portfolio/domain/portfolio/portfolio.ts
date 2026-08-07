import { DOMAIN_EVENT_SCHEMA_VERSION } from '../shared/constants.ts'
import { DomainInvariantError } from '../errors/invariant-error.ts'
import { domainFailure, type DomainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import {
  freezeDomainEvent,
  hasValidEventAggregateBinding,
  type DomainEventEnvelope,
  type PortfolioArchived,
  type PortfolioCreated,
  type PortfolioDomainEvent,
  type PortfolioModeChanged,
  type StrategyAllocationChanged,
} from '../events/domain-events.ts'
import {
  createCommandContext,
  type CommandContext,
} from '../shared/command-context.ts'
import {
  parseEventId,
  parsePortfolioId,
  type EventId,
  type PortfolioId,
} from '../shared/identifiers.ts'
import { createMoney, type Money } from '../shared/money.ts'
import {
  INITIAL_PORTFOLIO_STATE_VERSION,
  NO_PORTFOLIO_STATE_VERSION,
  nextPortfolioStateVersion,
  type PortfolioStateVersion,
} from '../shared/state-version.ts'
import { compareInstants, type Instant } from '../shared/time.ts'
import type {
  ArchivePortfolioCommand,
  ChangePortfolioModeCommand,
  CreatePortfolioCommand,
  ReplaceStrategyAllocationCommand,
  Transition,
} from './commands.ts'
import {
  isOperatingMode,
  validateModeEvidence,
  type OperatingMode,
} from './evidence.ts'
import type { Holding } from './holding.ts'
import {
  validatePortfolioIntegrity,
  validateTargetedTransition,
  type PortfolioStatus,
} from './integrity.ts'
import {
  allocationPoliciesEqual,
  allocationPolicyIdentity,
  validateStrategyAllocationPolicy,
  type StrategyAllocationPolicy,
} from './strategy-allocation.ts'
import {
  createPortfolioName,
  type PortfolioName,
} from './portfolio-name.ts'

export { createPortfolioName } from './portfolio-name.ts'
export type { PortfolioName } from './portfolio-name.ts'

export type PortfolioSnapshot = Readonly<{
  portfolioId: PortfolioId
  name: PortfolioName
  baseCurrency: 'INR'
  createdAt: Instant
  status: PortfolioStatus
  mode: OperatingMode
  cash: Money
  allocationPolicy: StrategyAllocationPolicy
  holdings: readonly Holding[]
  stateVersion: PortfolioStateVersion
}>

function freezeSnapshot(snapshot: PortfolioSnapshot): PortfolioSnapshot {
  return Object.freeze({
    ...snapshot,
    name: Object.isFrozen(snapshot.name)
      ? snapshot.name
      : Object.freeze({ ...snapshot.name }),
    holdings: Object.isFrozen(snapshot.holdings)
      ? snapshot.holdings
      : Object.freeze([...snapshot.holdings]),
  })
}

function createEnvelope(
  portfolioId: PortfolioId,
  stateVersion: PortfolioStateVersion,
  context: CommandContext,
  eventId: PortfolioDomainEvent['eventId'],
): DomainEventEnvelope {
  return Object.freeze({
    eventId,
    schemaVersion: DOMAIN_EVENT_SCHEMA_VERSION,
    portfolioId,
    stateVersion,
    occurredAt: context.effectiveAt,
    actorId: context.actorId,
    commandId: context.commandId,
    correlationId: context.correlationId,
    causationId: context.causationId,
  })
}

function validateCommandScope(
  snapshot: PortfolioSnapshot,
  portfolioId: PortfolioId,
  context: CommandContext,
  eventId: EventId,
): DomainFailure | undefined {
  if (
    !parsePortfolioId(portfolioId).ok
    || !parseEventId(eventId).ok
    || !createCommandContext(context).ok
  ) {
    return domainFailure('INVALID_IDENTIFIER', {
      field: 'command',
      retryability: 'NEVER',
    })
  }
  if (portfolioId !== snapshot.portfolioId) {
    return domainFailure('PORTFOLIO_SCOPE_MISMATCH', {
      field: 'portfolioId',
      retryability: 'NEVER',
    })
  }
  if (context.expectedStateVersion !== snapshot.stateVersion) {
    return domainFailure('PORTFOLIO_VERSION_CONFLICT', {
      field: 'expectedStateVersion',
      retryability: 'AFTER_STATE_REFRESH',
      context: {
        expected: context.expectedStateVersion,
        actual: snapshot.stateVersion,
      },
    })
  }
  if (compareInstants(context.effectiveAt, snapshot.createdAt) < 0) {
    return domainFailure('INVALID_EFFECTIVE_TIME', { field: 'effectiveAt' })
  }
  return undefined
}

export class Portfolio {
  readonly #snapshot: PortfolioSnapshot

  private constructor(snapshot: PortfolioSnapshot) {
    this.#snapshot = freezeSnapshot(snapshot)
    Object.freeze(this)
  }

  static create(command: CreatePortfolioCommand): DomainResult<Transition<Portfolio>> {
    if (
      !parsePortfolioId(command.portfolioId).ok
      || !parseEventId(command.eventId).ok
      || !createCommandContext(command.context).ok
    ) {
      return failure(domainFailure('INVALID_IDENTIFIER', {
        field: 'command',
        retryability: 'NEVER',
      }))
    }
    if (command.context.expectedStateVersion !== NO_PORTFOLIO_STATE_VERSION) {
      return failure(domainFailure('PORTFOLIO_VERSION_CONFLICT', {
        field: 'expectedStateVersion',
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
    const name = createPortfolioName(command.displayName)
    if (!name.ok) {
      return name
    }
    if (command.nameUniquenessVerified !== true) {
      return failure(domainFailure('NAME_UNIQUENESS_NOT_VERIFIED', {
        field: 'displayName',
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
    if (
      !createMoney(command.startingCash.minorUnits, command.startingCash.currency).ok
      || command.startingCash.minorUnits < 0n
    ) {
      return failure(domainFailure('INVALID_STARTING_CASH', { field: 'startingCash' }))
    }
    if (!isOperatingMode(command.mode)) {
      return failure(domainFailure('INVALID_OPERATING_MODE', { field: 'mode' }))
    }
    const modeEvidence = validateModeEvidence(
      command.modeEvidence,
      command.portfolioId,
      command.mode,
      command.context.effectiveAt,
    )
    if (!modeEvidence.ok) {
      return modeEvidence
    }
    if (compareInstants(command.allocationPolicy.effectiveAt, command.context.effectiveAt) < 0) {
      return failure(domainFailure('INVALID_INITIAL_CONFIGURATION', {
        field: 'allocationPolicy',
      }))
    }
    const allocation = validateStrategyAllocationPolicy(
      command.portfolioId,
      command.allocationPolicy,
    )
    if (!allocation.ok) {
      return allocation
    }

    const snapshot: PortfolioSnapshot = {
      portfolioId: command.portfolioId,
      name: name.value,
      baseCurrency: 'INR',
      createdAt: command.context.effectiveAt,
      status: 'ACTIVE',
      mode: command.mode,
      cash: command.startingCash,
      allocationPolicy: allocation.value,
      holdings: Object.freeze([]),
      stateVersion: INITIAL_PORTFOLIO_STATE_VERSION,
    }
    const integrity = validatePortfolioIntegrity(snapshot)
    if (!integrity.ok) {
      return failure(domainFailure('INVALID_INITIAL_STATE', {
        field: integrity.error.field ?? 'portfolio',
        retryability: 'NEVER',
      }))
    }

    const state = new Portfolio(snapshot)
    const event: PortfolioCreated = freezeDomainEvent({
      ...createEnvelope(
        command.portfolioId,
        INITIAL_PORTFOLIO_STATE_VERSION,
        command.context,
        command.eventId,
      ),
      type: 'PortfolioCreated',
      payload: {
        displayName: name.value.display,
        baseCurrency: 'INR',
        startingCash: command.startingCash,
        status: 'ACTIVE',
        mode: command.mode,
        allocationPolicyId: allocationPolicyIdentity(allocation.value),
      },
    })
    return success(Portfolio.transition(
      NO_PORTFOLIO_STATE_VERSION,
      state,
      [event],
      true,
    ))
  }

  static rehydrate(snapshot: PortfolioSnapshot): Portfolio {
    const integrity = validatePortfolioIntegrity(snapshot)
    if (!integrity.ok) {
      throw new DomainInvariantError()
    }
    return new Portfolio(snapshot)
  }

  get portfolioId(): PortfolioId {
    return this.#snapshot.portfolioId
  }

  get stateVersion(): PortfolioStateVersion {
    return this.#snapshot.stateVersion
  }

  get status(): PortfolioStatus {
    return this.#snapshot.status
  }

  get mode(): OperatingMode {
    return this.#snapshot.mode
  }

  get allocationPolicy(): StrategyAllocationPolicy {
    return this.#snapshot.allocationPolicy
  }

  get cash(): Money {
    return this.#snapshot.cash
  }

  get holdings(): readonly Holding[] {
    return this.#snapshot.holdings
  }

  snapshot(): PortfolioSnapshot {
    return this.#snapshot
  }

  archive(command: ArchivePortfolioCommand): DomainResult<Transition<Portfolio>> {
    const scopeFailure = validateCommandScope(
      this.#snapshot,
      command.portfolioId,
      command.context,
      command.eventId,
    )
    if (scopeFailure !== undefined) {
      return failure(scopeFailure)
    }
    if (this.#snapshot.status === 'ARCHIVED') {
      return success(Portfolio.transition(
        this.stateVersion,
        this,
        [],
        false,
      ))
    }
    const nextVersion = nextPortfolioStateVersion(this.stateVersion)
    if (!nextVersion.ok) {
      return nextVersion
    }
    const next = Portfolio.fromTransition(this.#snapshot, {
      status: 'ARCHIVED',
      stateVersion: nextVersion.value,
    })
    const event: PortfolioArchived = freezeDomainEvent({
      ...createEnvelope(this.portfolioId, nextVersion.value, command.context, command.eventId),
      type: 'PortfolioArchived',
      payload: {
        priorStatus: 'ACTIVE',
        status: 'ARCHIVED',
        effectiveAt: command.context.effectiveAt,
      },
    })
    return success(Portfolio.transition(this.stateVersion, next, [event], true))
  }

  changeMode(
    command: ChangePortfolioModeCommand,
  ): DomainResult<Transition<Portfolio>> {
    const scopeFailure = validateCommandScope(
      this.#snapshot,
      command.portfolioId,
      command.context,
      command.eventId,
    )
    if (scopeFailure !== undefined) {
      return failure(scopeFailure)
    }
    if (this.status === 'ARCHIVED') {
      return failure(domainFailure('PORTFOLIO_ARCHIVED', {
        field: 'status',
        retryability: 'NEVER',
      }))
    }
    if (!isOperatingMode(command.mode)) {
      return failure(domainFailure('INVALID_OPERATING_MODE', { field: 'mode' }))
    }
    if (command.mode === this.mode) {
      return success(Portfolio.transition(this.stateVersion, this, [], false))
    }
    const evidence = validateModeEvidence(
      command.evidence,
      this.portfolioId,
      command.mode,
      command.context.effectiveAt,
    )
    if (!evidence.ok) {
      return evidence
    }
    const nextVersion = nextPortfolioStateVersion(this.stateVersion)
    if (!nextVersion.ok) {
      return nextVersion
    }
    const next = Portfolio.fromTransition(this.#snapshot, {
      mode: command.mode,
      stateVersion: nextVersion.value,
    })
    const event: PortfolioModeChanged = freezeDomainEvent({
      ...createEnvelope(this.portfolioId, nextVersion.value, command.context, command.eventId),
      type: 'PortfolioModeChanged',
      payload: {
        priorMode: this.mode,
        mode: command.mode,
        evidenceIds: evidence.value.map((item) => item.evidenceId),
      },
    })
    return success(Portfolio.transition(this.stateVersion, next, [event], true))
  }

  replaceStrategyAllocation(
    command: ReplaceStrategyAllocationCommand,
  ): DomainResult<Transition<Portfolio>> {
    const scopeFailure = validateCommandScope(
      this.#snapshot,
      command.portfolioId,
      command.context,
      command.eventId,
    )
    if (scopeFailure !== undefined) {
      return failure(scopeFailure)
    }
    if (this.status === 'ARCHIVED') {
      return failure(domainFailure('PORTFOLIO_ARCHIVED', {
        field: 'status',
        retryability: 'NEVER',
      }))
    }
    if (allocationPoliciesEqual(this.allocationPolicy, command.allocationPolicy)) {
      return success(Portfolio.transition(this.stateVersion, this, [], false))
    }
    if (compareInstants(command.allocationPolicy.effectiveAt, command.context.effectiveAt) < 0) {
      return failure(domainFailure('INVALID_EFFECTIVE_TIME', {
        field: 'allocationPolicy.effectiveAt',
      }))
    }
    const allocation = validateStrategyAllocationPolicy(
      this.portfolioId,
      command.allocationPolicy,
    )
    if (!allocation.ok) {
      return allocation
    }
    const nextVersion = nextPortfolioStateVersion(this.stateVersion)
    if (!nextVersion.ok) {
      return nextVersion
    }
    const next = Portfolio.fromTransition(this.#snapshot, {
      allocationPolicy: allocation.value,
      stateVersion: nextVersion.value,
    })
    const event: StrategyAllocationChanged = freezeDomainEvent({
      ...createEnvelope(this.portfolioId, nextVersion.value, command.context, command.eventId),
      type: 'StrategyAllocationChanged',
      payload: {
        priorAllocationPolicyId: allocationPolicyIdentity(this.allocationPolicy),
        allocationPolicyId: allocationPolicyIdentity(allocation.value),
        effectiveAt: allocation.value.effectiveAt,
      },
    })
    return success(Portfolio.transition(this.stateVersion, next, [event], true))
  }

  private static fromTransition(
    prior: PortfolioSnapshot,
    changes: Partial<PortfolioSnapshot>,
  ): Portfolio {
    const snapshot = freezeSnapshot({ ...prior, ...changes })
    const targeted = validateTargetedTransition(prior, snapshot)
    if (!targeted.ok) {
      throw new DomainInvariantError()
    }
    return new Portfolio(snapshot)
  }

  private static transition(
    priorStateVersion: PortfolioStateVersion,
    state: Portfolio,
    events: readonly PortfolioDomainEvent[],
    changed: boolean,
  ): Transition<Portfolio> {
    const frozenEvents = Object.freeze([...events])
    if (
      frozenEvents.some((event) =>
        !hasValidEventAggregateBinding(event, state.portfolioId, state.stateVersion))
      || (changed && frozenEvents.length !== 1)
      || (!changed && frozenEvents.length !== 0)
    ) {
      throw new DomainInvariantError()
    }
    return Object.freeze({
      priorStateVersion,
      state,
      stateVersion: state.stateVersion,
      events: frozenEvents,
      changed,
    })
  }
}
