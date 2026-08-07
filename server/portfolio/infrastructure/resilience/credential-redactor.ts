const CREDENTIAL_FIELDS = new Set([
  'password', 'secret', 'token', 'credential', 'apikey', 'api_key',
  'accesstoken', 'access_token', 'refreshtoken', 'refresh_token',
  'authorization', 'auth', 'key', 'privatekey', 'private_key',
])
const MAX_CONTEXT_FIELDS = 10
const MAX_STRING_VALUE_LENGTH = 200

export class CredentialRedactor {
  private readonly credentialFieldNames: ReadonlySet<string>

  constructor(credentialFieldNames?: readonly string[]) {
    const names = credentialFieldNames
      ? new Set([...CREDENTIAL_FIELDS, ...credentialFieldNames.map(k => k.toLowerCase())])
      : CREDENTIAL_FIELDS
    this.credentialFieldNames = names
  }

  redactProviderContext(raw: unknown): Record<string, unknown> {
    if (typeof raw !== 'object' || raw === null) return {}
    const result: Record<string, unknown> = {}
    let count = 0
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (count >= MAX_CONTEXT_FIELDS) break
      count++
      if (this.credentialFieldNames.has(key.toLowerCase())) {
        result[key] = '[REDACTED]'
        continue
      }
      if (typeof value === 'object' && value !== null) {
        result[key] = '[OBJECT]'
        continue
      }
      if (typeof value === 'string' && value.length > MAX_STRING_VALUE_LENGTH) {
        result[key] = value.slice(0, MAX_STRING_VALUE_LENGTH) + '...[TRUNCATED]'
        continue
      }
      result[key] = value
    }
    return result
  }
}
