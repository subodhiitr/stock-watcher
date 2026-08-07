export class DomainInvariantError extends Error {
  readonly code: 'DOMAIN_INVARIANT_VIOLATION'

  constructor() {
    super('Trusted portfolio state violates a domain invariant')
    this.name = 'DomainInvariantError'
    this.code = 'DOMAIN_INVARIANT_VIOLATION'
  }
}
