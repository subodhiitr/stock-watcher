import { type DomainResult } from '../errors/result.ts';
import type { IntegrityHash } from '../portfolio/evidence.ts';
import type { FillId, InstrumentId } from '../shared/identifiers.ts';
import type { Money } from '../shared/money.ts';
import type { Quantity } from '../shared/quantity.ts';
import type { Instant } from '../shared/time.ts';
import { type BrokerSide, type NormalizedFill } from './contracts.ts';
export type FillIdentityKind = 'BROKER_ID' | 'CANONICAL_FINGERPRINT';
export type FillCharge = Readonly<{
    chargeCode: string;
    amount: Money;
    confirmed: true;
}>;
export type LotMutationKind = 'OPEN_FILL_LOT' | 'INCREASE_FILL_LOT' | 'REDUCE_EXISTING_LOT' | 'CLOSE_EXISTING_LOT';
export type LotMutation = Readonly<{
    kind: LotMutationKind;
    lotId: string;
    quantity: Quantity;
    unitCost?: Money;
}>;
export type AccountingDelta = Readonly<{
    fillId: FillId;
    cashDelta: Money;
    holdingDelta: bigint;
    lotMutations: readonly LotMutation[];
    deliveryDelta: bigint;
    reservationReleaseAmount: Money | Quantity;
    reservationSide: BrokerSide;
}>;
export type FillIdentity = Readonly<{
    fillId: FillId;
    kind: FillIdentityKind;
    brokerFillId?: string;
    contentHash: IntegrityHash;
}>;
type FillFingerprintInput = Readonly<{
    accountBindingId: string;
    brokerOrderId: string;
    instrumentId: InstrumentId;
    side: BrokerSide;
    quantity: Quantity;
    price: Money;
    tradeTime: Instant;
}>;
export declare function deriveFillIdentity(fillId: FillId, input: FillFingerprintInput, brokerFillId: string | undefined, contentHash: IntegrityHash): FillIdentity;
export declare function deriveFillFingerprintHash(input: FillFingerprintInput): DomainResult<IntegrityHash>;
export declare function validateIncrementalQuantity(orderQuantityCeiling: Quantity, alreadyFilledQuantity: Quantity, newIncrementalQuantity: Quantity): DomainResult<Quantity>;
export type FillConflictKind = 'DUPLICATE' | 'CONFLICT';
export declare function detectFillConflict(existingFills: readonly NormalizedFill[], candidateFillId: FillId, candidateContentHash: IntegrityHash): DomainResult<FillConflictKind | null>;
export declare function computeBuyAccountingDelta(fill: NormalizedFill, reservedCash: Money, fillId: FillId, fillLotId: string, existingLotCount: number): DomainResult<AccountingDelta>;
export declare function computeSellAccountingDelta(fill: NormalizedFill, fillId: FillId, lotMutations: readonly LotMutation[], reservedDeliveryQuantity: Quantity): DomainResult<AccountingDelta>;
export {};
