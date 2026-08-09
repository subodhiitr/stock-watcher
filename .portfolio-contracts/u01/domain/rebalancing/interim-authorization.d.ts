import type { ActionIntentMarker, InterimAuthorization, PlanningIntent } from '../construction/planning-context.ts';
import { type DomainResult } from '../errors/result.ts';
import { type SafeReasonBundle } from '../shared/safe-observability-payload-builder.ts';
import type { Instant } from '../shared/time.ts';
export type InterimAuthorizationDecision = Readonly<{
    authorized: boolean;
    permittedIntents: readonly ActionIntentMarker[];
    reasonBundle?: SafeReasonBundle;
}>;
export declare function authorizeInterimPlanning(input: Readonly<{
    planningIntent: PlanningIntent;
    authorization?: InterimAuthorization;
    actionIntents: readonly ActionIntentMarker[];
    createdAt: Instant;
}>): DomainResult<InterimAuthorizationDecision>;
