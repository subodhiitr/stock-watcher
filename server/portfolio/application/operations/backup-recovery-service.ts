import {
  operationsFailure,
  operationsSuccess,
  type BackupReceipt,
  type OperationsResult,
} from '../../domain/operations/contracts.ts'
import type {
  AuditIntegrityPort,
  BackupOperationsPort,
} from '../../ports/operations/operations-port.ts'
import type { OperationsHealthService } from './health-service.ts'

export class BackupRecoveryService {
  readonly #health: OperationsHealthService
  readonly #audit: AuditIntegrityPort
  readonly #backups: BackupOperationsPort

  constructor(
    health: OperationsHealthService,
    audit: AuditIntegrityPort,
    backups: BackupOperationsPort,
  ) {
    this.#health = health
    this.#audit = audit
    this.#backups = backups
  }

  async createVerifiedBackup(destination: string): Promise<OperationsResult<BackupReceipt>> {
    const health = await this.#health.inspect()
    if (!health.ok || health.value.state === 'BLOCKED') {
      return operationsFailure('OPERATIONS_HEALTH_BLOCKED', true)
    }
    const audit = await this.#audit.verify()
    if (!audit.valid) return operationsFailure('AUDIT_INTEGRITY_FAILED')
    try {
      const receipt = await this.#backups.create(destination)
      if (!(await this.#backups.verify(receipt))) {
        return operationsFailure('BACKUP_VERIFICATION_FAILED')
      }
      return operationsSuccess(receipt)
    } catch {
      return operationsFailure('BACKUP_FAILED', true)
    }
  }

  async restorePreflight(): Promise<OperationsResult<true>> {
    const health = await this.#health.inspect()
    if (!health.ok || health.value.state === 'BLOCKED') {
      return operationsFailure('OPERATIONS_HEALTH_BLOCKED', true)
    }
    const audit = await this.#audit.verify()
    return audit.valid
      ? operationsSuccess(true)
      : operationsFailure('AUDIT_INTEGRITY_FAILED')
  }
}
