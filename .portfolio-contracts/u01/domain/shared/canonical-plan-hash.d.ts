import type { IntegrityHash } from '../portfolio/evidence.ts';
import type { InstrumentId, PortfolioId } from './identifiers.ts';
export declare function canonicalPlanJson(value: unknown): string;
export declare function hashCanonicalPlan(value: unknown): IntegrityHash;
export declare function deriveLogicalOrderKey(input: Readonly<{
    portfolioId: PortfolioId;
    instrumentId: InstrumentId;
    side: string;
    semanticAction: unknown;
}>): IntegrityHash;
export declare function createPlanInputHash(input: unknown): IntegrityHash;
export declare function createPlanHash(plan: unknown): IntegrityHash;
export declare function createOptimizerRequestHash(request: unknown): IntegrityHash;
