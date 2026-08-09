import { type BackupReceipt, type OperationsResult } from '../../domain/operations/contracts.ts';
import type { AuditIntegrityPort, BackupOperationsPort } from '../../ports/operations/operations-port.ts';
import type { OperationsHealthService } from './health-service.ts';
export declare class BackupRecoveryService {
    #private;
    constructor(health: OperationsHealthService, audit: AuditIntegrityPort, backups: BackupOperationsPort);
    createVerifiedBackup(destination: string): Promise<OperationsResult<BackupReceipt>>;
    restorePreflight(): Promise<OperationsResult<true>>;
}
