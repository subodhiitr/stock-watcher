import { type DomainResult } from '../errors/result.ts';
import { type HoldingLotId, type InstrumentId, type PortfolioId } from '../shared/identifiers.ts';
import { type LocalDate } from '../shared/time.ts';
import { type Money } from '../shared/money.ts';
import { type Quantity } from '../shared/quantity.ts';
export type LotSourceKind = 'IMPORT' | 'FILL' | 'CORPORATE_ACTION';
export type LotSourceReference = Readonly<{
    kind: LotSourceKind;
    referenceId: string;
}>;
export type HoldingLot = Readonly<{
    lotId: HoldingLotId;
    portfolioId: PortfolioId;
    instrumentId: InstrumentId;
    acquiredOn: LocalDate;
    originalQuantity: Quantity;
    openQuantity: Quantity;
    unitCost: Money;
    sourceReference: LotSourceReference;
}>;
export declare function createHoldingLot(input: HoldingLot): DomainResult<HoldingLot>;
