export {
  openPortfolioDatabase,
  type PortfolioBackupReceipt,
  type PortfolioDatabaseOwner,
} from './database-owner.ts'
export {
  defaultPortfolioDatabaseConfiguration,
  type DatabaseOwnerMode,
  type PortfolioDatabaseConfiguration,
} from './configuration.ts'
export {
  RejectingEncryptionAttestation,
  TemporaryTestEncryptionAttestation,
  type EncryptionAttestation,
  type EncryptionAttestationPort,
  type EncryptionProtection,
  type EncryptionPurpose,
} from './encryption-attestation.ts'
export {
  type PersistenceFailure,
  type PersistenceFailureCode,
  type PersistenceResult,
} from './failures.ts'
export type { PortfolioDatabaseHealth } from './health.ts'
export type { ExecutionUnitOfWork } from '../../ports/execution/execution-unit-of-work.ts'
