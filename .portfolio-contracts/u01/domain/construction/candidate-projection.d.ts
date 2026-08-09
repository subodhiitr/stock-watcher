import { type DomainResult } from '../errors/result.ts';
import { type SafeReasonBundle } from '../shared/safe-observability-payload-builder.ts';
import type { PlanningCandidate } from './planning-context.ts';
export type ProjectedCandidate = Readonly<{
    candidate: PlanningCandidate;
    reasonBundle: SafeReasonBundle;
}>;
export type CandidateProjection = Readonly<{
    mandatoryExits: readonly ProjectedCandidate[];
    holdEligibleIncumbents: readonly ProjectedCandidate[];
    newEntrants: readonly ProjectedCandidate[];
    excludedCandidates: readonly ProjectedCandidate[];
    blockedCandidates: readonly ProjectedCandidate[];
}>;
export declare function projectCandidates(candidates: readonly PlanningCandidate[]): DomainResult<CandidateProjection>;
