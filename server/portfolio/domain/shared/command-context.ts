import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type {
  ActorId,
  CausationId,
  CommandId,
  CorrelationId,
} from './identifiers.ts'
import {
  parseActorId,
  parseCausationId,
  parseCommandId,
  parseCorrelationId,
} from './identifiers.ts'
import {
  createPortfolioStateVersion,
  type PortfolioStateVersion,
} from './state-version.ts'
import { parseInstant, type Instant } from './time.ts'

export type CommandContext = Readonly<{
  commandId: CommandId
  actorId: ActorId
  correlationId: CorrelationId
  causationId: CausationId
  effectiveAt: Instant
  expectedStateVersion: PortfolioStateVersion
}>

export function createCommandContext(input: CommandContext): DomainResult<CommandContext> {
  if (
    !parseCommandId(input.commandId).ok
    || !parseActorId(input.actorId).ok
    || !parseCorrelationId(input.correlationId).ok
    || !parseCausationId(input.causationId).ok
    || !parseInstant(input.effectiveAt).ok
    || !createPortfolioStateVersion(
      input.expectedStateVersion,
      input.expectedStateVersion === 0,
    ).ok
  ) {
    return failure(domainFailure('MISSING_COMMAND_CONTEXT', {
      field: 'context',
      retryability: 'AFTER_CORRECTION',
    }))
  }
  return success(Object.freeze({ ...input }))
}
