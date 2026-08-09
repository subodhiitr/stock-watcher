import type { Instant } from '../../domain/shared/time.ts';
import { type PersistenceResult } from './failures.ts';
export type EncryptionPurpose = 'DATABASE' | 'BACKUP';
export type EncryptionProtection = 'BITLOCKER' | 'EFS' | 'TEMPORARY_TEST';
export type EncryptionAttestation = Readonly<{
    protected: true;
    protection: EncryptionProtection;
    attestedAt: Instant;
}>;
export interface EncryptionAttestationPort {
    attest(canonicalPath: string, purpose: EncryptionPurpose): PersistenceResult<EncryptionAttestation>;
}
export declare class RejectingEncryptionAttestation implements EncryptionAttestationPort {
    attest(): PersistenceResult<EncryptionAttestation>;
}
export declare class TemporaryTestEncryptionAttestation implements EncryptionAttestationPort {
    #private;
    constructor(attestedAt: Instant);
    attest(): PersistenceResult<EncryptionAttestation>;
}
