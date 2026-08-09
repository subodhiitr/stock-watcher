import { type DomainResult } from '../../domain/errors/result.ts';
import type { DataVersionSnapshot } from '../../domain/market-data/data-version-snapshot.ts';
export type ResearchLabelled<T> = Readonly<{
    value: T;
    researchModeOnly: true;
    label: 'RESEARCH_MODE_ONLY';
}>;
export declare class ResearchModeGate {
    checkProductionAllowed(snapshot: DataVersionSnapshot, currentInstant: string): DomainResult<void>;
    wrapResult<T>(result: T, _mode: 'production' | 'research'): ResearchLabelled<T>;
}
