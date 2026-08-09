import { type DomainResult } from '../errors/result.ts';
import { type HoldingId, type InstrumentId, type PortfolioId } from '../shared/identifiers.ts';
import { type Quantity } from '../shared/quantity.ts';
import { type PortfolioStateVersion } from '../shared/state-version.ts';
import { type HoldingLot } from './holding-lot.ts';
export type Holding = Readonly<{
    holdingId: HoldingId;
    portfolioId: PortfolioId;
    instrumentId: InstrumentId;
    totalQuantity: Quantity;
    availableDeliveryQuantity: Quantity;
    reservedQuantity: Quantity;
    lots: readonly HoldingLot[];
    stateVersion: PortfolioStateVersion;
    marginFunded: false;
}>;
export type HoldingInput = Omit<Holding, 'marginFunded'> & Readonly<{
    marginFunded: boolean;
}>;
export declare function createHolding(input: HoldingInput): DomainResult<Holding>;
