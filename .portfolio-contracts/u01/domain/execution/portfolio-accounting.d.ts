import { type DomainResult } from '../errors/result.ts';
import { Portfolio } from '../portfolio/portfolio.ts';
import { type HoldingId, type InstrumentId } from '../shared/identifiers.ts';
import { type Quantity } from '../shared/quantity.ts';
import type { LocalDate } from '../shared/time.ts';
import type { NormalizedFill } from './contracts.ts';
import type { AccountingDelta } from './fill-accounting.ts';
export declare function reserveSellDelivery(portfolio: Portfolio, instrumentId: InstrumentId, quantity: Quantity): DomainResult<Portfolio>;
export declare function releaseSellDelivery(portfolio: Portfolio, instrumentId: InstrumentId, quantity: Quantity): DomainResult<Portfolio>;
export type ApplyFillAccountingInput = Readonly<{
    portfolio: Portfolio;
    fill: NormalizedFill;
    delta: AccountingDelta;
    acquiredOn: LocalDate;
    newHoldingId?: HoldingId;
}>;
export declare function applyFillAccounting(input: ApplyFillAccountingInput): DomainResult<Portfolio>;
