import type { Instant } from '../../domain/shared/time.ts';
import { type IncidentRecord, type IncidentSeverity, type OperationsResult } from '../../domain/operations/contracts.ts';
import type { IncidentRepositoryPort } from '../../ports/operations/operations-port.ts';
export declare class IncidentService {
    #private;
    constructor(incidents: IncidentRepositoryPort);
    open(input: Readonly<{
        incidentId: string;
        severity: IncidentSeverity;
        openedAt: Instant;
        code: string;
        correlationId: string;
    }>): Promise<OperationsResult<IncidentRecord>>;
    close(current: IncidentRecord, closedAt: Instant, actionCodes: readonly string[]): Promise<OperationsResult<IncidentRecord>>;
}
