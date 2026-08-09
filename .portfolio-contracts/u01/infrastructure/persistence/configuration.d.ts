import type { Instant } from '../../domain/shared/time.ts';
import type { EncryptionAttestationPort } from './encryption-attestation.ts';
export type DatabaseOwnerMode = 'PERSISTENT' | 'TEMPORARY_TEST';
export type PortfolioDatabaseConfiguration = Readonly<{
    databasePath: string;
    mode: DatabaseOwnerMode;
    protectedLegacyPaths: readonly string[];
    busyTimeoutMs: number;
    encryptionAttestation: EncryptionAttestationPort;
    now: () => Instant;
    defaultStartingCashMinorUnits: bigint;
}>;
export declare function defaultPortfolioDatabaseConfiguration(databasePath: string, protectedLegacyPaths: readonly string[], encryptionAttestation: EncryptionAttestationPort, now: () => Instant): PortfolioDatabaseConfiguration;
