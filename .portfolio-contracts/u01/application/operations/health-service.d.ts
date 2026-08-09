import { type OperationsHealth, type OperationsResult } from '../../domain/operations/contracts.ts';
import type { HealthProbePort, OperationsClockPort } from '../../ports/operations/operations-port.ts';
export declare class OperationsHealthService {
    #private;
    constructor(probes: readonly HealthProbePort[], clock: OperationsClockPort);
    inspect(): Promise<OperationsResult<OperationsHealth>>;
}
