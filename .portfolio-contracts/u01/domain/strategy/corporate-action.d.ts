import { type DomainResult } from '../errors/result.ts';
import type { CorporateActionId, InstrumentId } from '../shared/identifiers.ts';
export type CorporateActionType = 'SPLIT' | 'BONUS' | 'CASH_DIVIDEND' | 'RIGHTS' | 'MERGER' | 'DEMERGER' | 'SYMBOL_CHANGE' | 'DELISTING' | 'BUYBACK_TENDER' | 'ETF_UNIT_CHANGE';
export type CorporateActionStatus = 'PENDING' | 'PROCESSED' | 'BLOCKED' | 'REQUIRES_MANUAL_REVIEW';
export type CorporateActionImpact = Readonly<{
    priceAdjustmentFactor: number;
    quantityAdjustmentFactor: number;
    taxLotLineagePreserved: boolean;
    symbolMapping?: string;
    economicValueConserved: boolean;
}>;
export type CorporateAction = Readonly<{
    actionId: CorporateActionId;
    instrumentId: InstrumentId;
    actionType: CorporateActionType;
    status: CorporateActionStatus;
    effectiveDate: string;
    announcedAt: string;
    source: 'EXCHANGE_FILING' | 'LICENSED_PROVIDER';
    impact: CorporateActionImpact | null;
    notes: string;
    createdAt: string;
    updatedAt: string;
}>;
export declare function createCorporateAction(params: {
    actionId: CorporateActionId;
    instrumentId: InstrumentId;
    actionType: CorporateActionType;
    effectiveDate: string;
    announcedAt: string;
    source: 'EXCHANGE_FILING' | 'LICENSED_PROVIDER';
    notes?: string;
    createdAt: string;
}): DomainResult<CorporateAction>;
export declare function applyCorporateActionTransition(action: CorporateAction, to: CorporateActionStatus, updatedAt: string, impact?: CorporateActionImpact): DomainResult<CorporateAction>;
