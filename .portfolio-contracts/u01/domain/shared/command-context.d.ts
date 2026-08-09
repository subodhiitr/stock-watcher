import { type DomainResult } from '../errors/result.ts';
import type { ActorId, CausationId, CommandId, CorrelationId } from './identifiers.ts';
import { type PortfolioStateVersion } from './state-version.ts';
import { type Instant } from './time.ts';
export type CommandContext = Readonly<{
    commandId: CommandId;
    actorId: ActorId;
    correlationId: CorrelationId;
    causationId: CausationId;
    effectiveAt: Instant;
    expectedStateVersion: PortfolioStateVersion;
}>;
export declare function createCommandContext(input: CommandContext): DomainResult<CommandContext>;
