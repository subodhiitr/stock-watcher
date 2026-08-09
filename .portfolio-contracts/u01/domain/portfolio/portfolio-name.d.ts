import { type DomainResult } from '../errors/result.ts';
export type PortfolioName = Readonly<{
    display: string;
    uniquenessKey: string;
}>;
export declare function createPortfolioName(value: unknown): DomainResult<PortfolioName>;
