import type { AnyDomainFailure, DomainResult } from '../../domain/errors/result.ts';
export interface ExchangeCalendarPort {
    isTradingDay(params: {
        date: string;
        correlationId: string;
    }): Promise<DomainResult<boolean, AnyDomainFailure>>;
    nextTradingDay(params: {
        afterDate: string;
        correlationId: string;
    }): Promise<DomainResult<string, AnyDomainFailure>>;
    previousTradingDay(params: {
        beforeDate: string;
        correlationId: string;
    }): Promise<DomainResult<string, AnyDomainFailure>>;
    getSessionTiming(params: {
        date: string;
        correlationId: string;
    }): Promise<DomainResult<{
        openTime: string;
        closeTime: string;
    }, AnyDomainFailure>>;
}
