import { type DomainResult } from '../errors/result.ts';
declare const stateVersionBrand: unique symbol;
export type PortfolioStateVersion = number & {
    readonly [stateVersionBrand]: 'PortfolioStateVersion';
};
export declare const INITIAL_PORTFOLIO_STATE_VERSION: PortfolioStateVersion;
export declare const NO_PORTFOLIO_STATE_VERSION: PortfolioStateVersion;
export declare function createPortfolioStateVersion(value: unknown, allowZero?: boolean): DomainResult<PortfolioStateVersion>;
export declare function nextPortfolioStateVersion(current: PortfolioStateVersion): DomainResult<PortfolioStateVersion>;
export declare function serializePortfolioStateVersion(value: PortfolioStateVersion): string;
export declare function parsePortfolioStateVersion(value: unknown): DomainResult<PortfolioStateVersion>;
export {};
