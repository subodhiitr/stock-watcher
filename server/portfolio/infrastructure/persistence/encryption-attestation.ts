import { failure, success } from '../../domain/errors/result.ts'
import type { Instant } from '../../domain/shared/time.ts'
import {
  persistenceFailure,
  type PersistenceResult,
} from './failures.ts'

export type EncryptionPurpose = 'DATABASE' | 'BACKUP'
export type EncryptionProtection = 'BITLOCKER' | 'EFS' | 'TEMPORARY_TEST'

export type EncryptionAttestation = Readonly<{
  protected: true
  protection: EncryptionProtection
  attestedAt: Instant
}>

export interface EncryptionAttestationPort {
  attest(
    canonicalPath: string,
    purpose: EncryptionPurpose,
  ): PersistenceResult<EncryptionAttestation>
}

export class RejectingEncryptionAttestation implements EncryptionAttestationPort {
  attest(): PersistenceResult<EncryptionAttestation> {
    return failure(persistenceFailure('ENCRYPTION_AT_REST_REQUIRED', {
      field: 'databasePath',
    }))
  }
}

export class TemporaryTestEncryptionAttestation implements EncryptionAttestationPort {
  readonly #attestedAt: Instant

  constructor(attestedAt: Instant) {
    this.#attestedAt = attestedAt
    Object.freeze(this)
  }

  attest(): PersistenceResult<EncryptionAttestation> {
    return success(Object.freeze({
      protected: true,
      protection: 'TEMPORARY_TEST',
      attestedAt: this.#attestedAt,
    }))
  }
}
