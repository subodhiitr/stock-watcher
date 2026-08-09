import type { PortfolioDomainEvent } from '../events/domain-events.ts';
import type { CommandContext } from '../shared/command-context.ts';
import type { EventId, PortfolioId } from '../shared/identifiers.ts';
import type { Money } from '../shared/money.ts';
import type { PortfolioStateVersion } from '../shared/state-version.ts';
import type { ModeTransitionEvidence, OperatingMode } from './evidence.ts';
import type { StrategyAllocationPolicy } from './strategy-allocation.ts';
export type CreatePortfolioCommand = Readonly<{
    portfolioId: PortfolioId;
    displayName: string;
    startingCash: Money;
    mode: OperatingMode;
    modeEvidence: readonly ModeTransitionEvidence[];
    allocationPolicy: StrategyAllocationPolicy;
    nameUniquenessVerified: boolean;
    context: CommandContext;
    eventId: EventId;
}>;
export type ArchivePortfolioCommand = Readonly<{
    portfolioId: PortfolioId;
    context: CommandContext;
    eventId: EventId;
}>;
export type ChangePortfolioModeCommand = Readonly<{
    portfolioId: PortfolioId;
    mode: OperatingMode;
    evidence: readonly ModeTransitionEvidence[];
    context: CommandContext;
    eventId: EventId;
}>;
export type ReplaceStrategyAllocationCommand = Readonly<{
    portfolioId: PortfolioId;
    allocationPolicy: StrategyAllocationPolicy;
    context: CommandContext;
    eventId: EventId;
}>;
export type PortfolioCommand = ArchivePortfolioCommand | ChangePortfolioModeCommand | ReplaceStrategyAllocationCommand;
export type Transition<T> = Readonly<{
    priorStateVersion: PortfolioStateVersion;
    state: T;
    stateVersion: PortfolioStateVersion;
    events: readonly PortfolioDomainEvent[];
    changed: boolean;
}>;
