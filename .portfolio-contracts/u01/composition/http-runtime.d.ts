import type * as http from 'node:http';
import { type PortfolioDatabaseOwner } from '../infrastructure/persistence/database-owner.ts';
export type PortfolioHttpRuntime = Readonly<{
    handle(request: http.IncomingMessage, response: http.ServerResponse, pathname: string): Promise<boolean>;
    close(): void;
    configured: boolean;
}>;
export type PortfolioHttpRuntimeOptions = Readonly<{
    owner?: PortfolioDatabaseOwner;
    now?: () => number;
    allowedOrigins?: readonly string[];
    secureCookies?: boolean;
    bootstrap?: Readonly<{
        username?: string;
        password?: string;
        displayName?: string;
        mfaSecret?: string;
    }>;
}>;
export declare function createPortfolioHttpRuntime(options?: PortfolioHttpRuntimeOptions): PortfolioHttpRuntime;
